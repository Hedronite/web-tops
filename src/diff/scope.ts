import { readFileSync } from "node:fs";
import { join } from "node:path";
import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import { vitestCoverageOf, coveredSpans } from "./coverage.ts";
import { functionsIn, innermostAt } from "./functions.ts";
import { diffText, mergeBaseOf } from "./git.ts";
import { parseDiff } from "./parse.ts";
import type { ChangedFile, CoverageMap, DiffScope, FunctionRef, ScopeResult } from "./types.ts";

export type CoverageOf = (testFile: string) => Promise<CoverageMap | undefined>;

export interface ScopeOptions {
  readonly cwd: string;
  /** The ref the run is judged against, such as `origin/main`. */
  readonly base: string;
  readonly exec?: Exec;
  /** What a test file covers; by default a Vitest run of that file alone. */
  readonly coverageOf?: CoverageOf;
}

interface Entry {
  readonly path: string;
  readonly start: number;
  end: number;
}

type Covered =
  | { readonly ok: true; readonly refs: readonly FunctionRef[] }
  | { readonly ok: false; readonly reason: string };

type Reader = (path: string) => string | undefined;

const TEST = /\.(test|spec)\.[cm]?tsx?$|(^|\/)__tests__\//;
const SOURCE = /\.[cm]?tsx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;

export const isTestFile = (path: string): boolean => TEST.test(path) && SOURCE.test(path);
export const isSourceFile = (path: string): boolean =>
  SOURCE.test(path) && !DECLARATION.test(path) && !TEST.test(path);

function readerFor(cwd: string): Reader {
  return (path) => {
    try {
      return readFileSync(join(cwd, path), "utf8");
    } catch {
      return undefined;
    }
  };
}

const span = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index);

function uniqueByKey(refs: readonly FunctionRef[]): readonly FunctionRef[] {
  return [...new Map(refs.map((ref) => [ref.key, ref])).values()];
}

/** The functions that hold a changed line, or that a pure deletion was taken from. */
function changedIn(file: ChangedFile, read: Reader): readonly FunctionRef[] {
  const text = read(file.path);
  if (text === undefined) return [];
  const spans = functionsIn(file.path, text);
  const lines = [
    ...file.ranges.flatMap((range) => span(range.start, range.end)),
    ...file.removedAfter.map((after) =>
      innermostAt(spans, after) === undefined ? after + 1 : after,
    ),
  ];
  const found = lines.map((line) => innermostAt(spans, line));
  return found
    .filter((entry) => entry !== undefined)
    .map((entry) => ({ ...entry, path: file.path }));
}

function refsCovered(map: CoverageMap, read: Reader): readonly FunctionRef[] {
  return [...map.entries()].flatMap(([path, hits]) => {
    const text = isSourceFile(path) ? read(path) : undefined;
    if (text === undefined) return [];
    return coveredSpans(functionsIn(path, text), hits).map((entry) => ({ ...entry, path }));
  });
}

async function coveredFunctions(
  tests: readonly string[],
  coverageOf: CoverageOf,
  read: Reader,
): Promise<Covered> {
  const refs: FunctionRef[] = [];
  for (const test of tests) {
    const map = await coverageOf(test);
    if (map === undefined) {
      return { ok: false, reason: `could not run ${test} to find the functions it covers` };
    }
    refs.push(...refsCovered(map, read));
  }
  return { ok: true, refs: uniqueByKey(refs) };
}

const touches = (last: Entry | undefined, entry: Entry): boolean =>
  last !== undefined && last.path === entry.path && entry.start <= last.end + 1;

/** Sorts ranges by file and start, and joins those that overlap or touch. */
function merged(entries: readonly Entry[]): readonly Entry[] {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path) || a.start - b.start);
  const out: Entry[] = [];
  for (const entry of sorted) {
    const last = out.at(-1);
    if (last !== undefined && touches(last, entry)) last.end = Math.max(last.end, entry.end);
    else out.push({ ...entry });
  }
  return out;
}

const NO_LINES = "no changed source line and no function covered by a changed test";

function scopeOf(
  mergeBase: string,
  files: readonly ChangedFile[],
  read: Reader,
  covered: readonly FunctionRef[],
): DiffScope {
  const sources = files.filter((file) => file.status !== "deleted" && isSourceFile(file.path));
  const entries = [
    ...sources.flatMap((file) => file.ranges.map((range) => ({ path: file.path, ...range }))),
    ...covered.map((ref) => ({ path: ref.path, start: ref.start, end: ref.end })),
  ];
  return {
    mergeBase,
    files,
    changedFunctions: uniqueByKey(sources.flatMap((file) => changedIn(file, read))),
    testFiles: files
      .filter((file) => file.status !== "deleted" && isTestFile(file.path))
      .map((file) => file.path),
    coveredFunctions: covered,
    mutate: merged(entries).map(
      (entry) => `${entry.path}:${String(entry.start)}-${String(entry.end)}`,
    ),
  };
}

async function assemble(
  options: ScopeOptions,
  exec: Exec,
  mergeBase: string,
  files: readonly ChangedFile[],
): Promise<ScopeResult> {
  const read = readerFor(options.cwd);
  const coverageOf =
    options.coverageOf ?? ((test: string) => vitestCoverageOf(test, { cwd: options.cwd, exec }));
  const tests = files
    .filter((file) => file.status !== "deleted" && isTestFile(file.path))
    .map((file) => file.path);
  const covered = await coveredFunctions(tests, coverageOf, read);
  if (!covered.ok) return { outcome: "fail", reason: covered.reason };
  const scope = scopeOf(mergeBase, files, read, covered.refs);
  return scope.mutate.length === 0
    ? { outcome: "vacuous", reason: NO_LINES, scope }
    : { outcome: "scope", scope };
}

/**
 * The diff of this run against the merge base of HEAD and `base` (WEB_TOPS.md section 6.4): the changed
 * source lines and the functions they fall in, and the functions every changed test file covers. A shallow
 * clone, a missing base or no merge base is `fail`. A diff with no changed source line and no covered function
 * is `vacuous`, with the scope it found; a diff that changes only tests is not vacuous when they cover something.
 */
export async function diffScope(options: ScopeOptions): Promise<ScopeResult> {
  const exec = options.exec ?? realExec;
  const base = await mergeBaseOf(exec, options.cwd, options.base);
  if (!base.ok) return { outcome: "fail", reason: base.reason };
  const text = await diffText(exec, options.cwd, base.value);
  if (!text.ok) return { outcome: "fail", reason: text.reason };
  return assemble(options, exec, base.value, parseDiff(text.value));
}
