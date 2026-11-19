import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import { vitestCoverageOf, coveredSpans } from "./coverage.ts";
import { functionsIn, innermostAt } from "./functions.ts";
import { diffText, mergeBaseOf, showAt } from "./git.ts";
import { parseDiff } from "./parse.ts";
import type {
  ChangedFile,
  CoverageMap,
  DiffScope,
  FunctionRef,
  FunctionSpan,
  ScopeResult,
} from "./types.ts";

export type CoverageOf = (testFile: string) => Promise<CoverageMap | undefined>;

export interface ScopeOptions {
  readonly cwd: string;
  /** The ref the run is judged against, such as `origin/main`. */
  readonly base: string;
  readonly exec?: Exec;
  /** What a test file covers; by default a Vitest run of that file alone. */
  readonly coverageOf?: CoverageOf;
  /** Reasoned coverage exclusions from `web-tops.yaml`, passed to the default per-file run. */
  readonly exclude?: readonly string[];
  /** The random part of a merge-base copy's name; a test sets it to know the name. */
  readonly copyToken?: (() => string) | undefined;
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

/**
 * The data trees of section 17: fixtures and probes break rules on purpose (a bad twin of W-34 is a focused test), so a
 * changed file under them is neither source to mutate nor a test to run.
 */
const DATA_TREE = /^(?:fixtures|probes)\//u;

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

/**
 * Where a pure deletion belongs: the smallest function that holds the line before it and the line after it, and
 * the file's `<module>` when no function holds both (a line between two functions, or a whole function removed).
 */
function deletionTarget(spans: readonly FunctionSpan[], after: number): FunctionSpan | undefined {
  const holding = spans.filter((span) => span.start <= after && after + 1 <= span.end);
  return innermostAt(holding, after) ?? spans[0];
}

/** The functions that hold a changed line, or that a pure deletion was taken from. */
function changedIn(file: ChangedFile, read: Reader): readonly FunctionRef[] {
  const text = read(file.path);
  if (text === undefined) return [];
  const spans = functionsIn(file.path, text);
  const found = [
    ...file.ranges
      .flatMap((range) => span(range.start, range.end))
      .map((line) => innermostAt(spans, line)),
    ...file.removedAfter.map((after) => deletionTarget(spans, after)),
  ];
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

interface CoverRun {
  readonly coverageOf: CoverageOf;
  readonly read: Reader;
  /** The coverage of a test file as it was at the merge base, or undefined when it has none or cannot run. */
  readonly baseCoverageOf: CoverageOf;
}

const NONE: CoverageMap = new Map();

async function headMap(test: ChangedFile, run: CoverRun): Promise<CoverageMap | undefined> {
  return test.status === "deleted" ? NONE : run.coverageOf(test.path);
}

async function baseMap(test: ChangedFile, run: CoverRun): Promise<CoverageMap> {
  return test.status === "added" ? NONE : ((await run.baseCoverageOf(test.path)) ?? NONE);
}

/**
 * The functions every changed test file covers, as it is at HEAD and as it was at the merge base (so a test
 * that dropped a call keeps the function it no longer calls in scope). A head version that cannot run is `fail`;
 * a merge-base version that cannot run against the head is left out.
 */
async function coveredFunctions(tests: readonly ChangedFile[], run: CoverRun): Promise<Covered> {
  const refs: FunctionRef[] = [];
  for (const test of tests) {
    const head = await headMap(test, run);
    if (head === undefined) {
      return { ok: false, reason: `could not run ${test.path} to find the functions it covers` };
    }
    refs.push(...refsCovered(head, run.read), ...refsCovered(await baseMap(test, run), run.read));
  }
  return { ok: true, refs: uniqueByKey(refs) };
}

const randomToken = (): string => randomBytes(6).toString("hex");

/**
 * Where the merge-base copy of a test file goes: beside it, with the token before the `.test` or `.spec` marker
 * (so the project's test globs still match) or before the extension (so an `__tests__/` file still lives there).
 * The token is in every name, so a copy's name is never the original's.
 */
function copyName(test: string, token: string): string {
  const name = basename(test);
  const marked = /\.(test|spec)\./.test(name);
  const fresh = marked
    ? name.replace(/\.(test|spec)\./, `.wt-base-${token}.$1.`)
    : name.replace(/(\.[^.]+)$/, `.wt-base-${token}$1`);
  return join(dirname(test), fresh);
}

/** Creates the file, and only if nothing is there: an existing path is refused, so it is never overwritten. */
function createCopy(path: string, text: string): boolean {
  try {
    writeFileSync(path, text, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

/**
 * The coverage of the merge-base copy of a test file, written beside the original so its imports resolve, run,
 * and removed. Only a file this created is removed; a path that is already taken means no run (undefined).
 */
async function baseCoverage(
  options: ScopeOptions,
  exec: Exec,
  mergeBase: string,
  coverageOf: CoverageOf,
  test: string,
): Promise<CoverageMap | undefined> {
  const shown = await showAt(exec, options.cwd, mergeBase, test);
  if (!shown.ok) return undefined;
  const copy = copyName(test, (options.copyToken ?? randomToken)());
  const path = join(options.cwd, copy);
  return createCopy(path, shown.value) ? runCopy(coverageOf, copy, path) : undefined;
}

/** Runs the coverage of a copy this created, and removes the copy whatever happens. */
async function runCopy(
  coverageOf: CoverageOf,
  copy: string,
  path: string,
): Promise<CoverageMap | undefined> {
  try {
    return await coverageOf(copy);
  } catch {
    return undefined;
  } finally {
    rmSync(path, { force: true });
  }
}

const touches = (last: Entry | undefined, entry: Entry): boolean =>
  last !== undefined && last.path === entry.path && entry.start <= last.end + 1;

/** The order of two ranges: by file, then by start. */
function byPathThenStart(a: Entry, b: Entry): number {
  return a.path.localeCompare(b.path) || a.start - b.start;
}

/** Sorts ranges by file and start, and joins those that overlap or touch. */
function merged(entries: readonly Entry[]): readonly Entry[] {
  const sorted = [...entries].sort(byPathThenStart);
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
    testFiles: files.filter((file) => isTestFile(file.path)).map((file) => file.path),
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
    options.coverageOf ??
    ((test: string) =>
      vitestCoverageOf(test, { cwd: options.cwd, exec, exclude: options.exclude ?? [] }));
  const baseCoverageOf = (test: string): Promise<CoverageMap | undefined> =>
    baseCoverage(options, exec, mergeBase, coverageOf, test);
  const tests = files.filter((file) => isTestFile(file.path));
  const covered = await coveredFunctions(tests, { coverageOf, read, baseCoverageOf });
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
  return assemble(
    options,
    exec,
    base.value,
    parseDiff(text.value).filter((file) => !DATA_TREE.test(file.path)),
  );
}
