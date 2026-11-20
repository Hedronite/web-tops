import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import {
  vitestCoverageOf,
  vitestCoverageOfMany,
  coveredSpans,
  type CoverageRun,
} from "./coverage.ts";
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

/** What several test files cover together: one run for all of them, the functions any of them ran. */
export type CoverageOfMany = (testFiles: readonly string[]) => Promise<CoverageMap | undefined>;

export interface ScopeOptions {
  readonly cwd: string;
  /** The ref the run is judged against, such as `origin/main`. */
  readonly base: string;
  readonly exec?: Exec;
  /** What a test file covers; by default a Vitest run of that file alone. */
  readonly coverageOf?: CoverageOf;
  /**
   * What test files cover together, in one run: used, when given, before `coverageOf`, which then only runs the files of
   * a group that did not run together. By default a Vitest run of a whole group, when `coverageOf` is not given either.
   */
  readonly coverageOfMany?: CoverageOfMany;
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

/** How many test files one run covers at most, so that a very large diff never overruns the length of a command line. */
const GROUP = 100;

function groupsOf(paths: readonly string[]): string[][] {
  return Array.from({ length: Math.ceil(paths.length / GROUP) }, (_, at) =>
    paths.slice(at * GROUP, (at + 1) * GROUP),
  );
}

interface Gathered {
  readonly maps: readonly CoverageMap[];
  /** The files that could not run alone, in the order given. */
  readonly failed: readonly string[];
}

/** What the files cover, one run each: a file that cannot run is `failed`. */
async function alone(group: readonly string[], one: CoverageOf): Promise<Gathered> {
  const maps: CoverageMap[] = [];
  const failed: string[] = [];
  for (const path of group) {
    const got = await one(path);
    if (got === undefined) failed.push(path);
    else maps.push(got);
  }
  return { maps, failed };
}

/** A group in one run when `many` is given, and file by file where that run gives nothing. */
async function groupCoverage(
  group: readonly string[],
  one: CoverageOf,
  many: CoverageOfMany | undefined,
): Promise<Gathered> {
  const together = many === undefined ? undefined : await many(group);
  return together === undefined ? alone(group, one) : { maps: [together], failed: [] };
}

/**
 * What `paths` cover. Each group of them runs together when `many` is given; a group that does not run together (one
 * of its files fails, or the run leaves nothing) runs file by file, as every file did before, so a file that cannot
 * run is found and named whatever the others do.
 */
async function gather(
  paths: readonly string[],
  one: CoverageOf,
  many: CoverageOfMany | undefined,
): Promise<Gathered> {
  const found: Gathered[] = [];
  for (const group of groupsOf(paths)) found.push(await groupCoverage(group, one, many));
  return { maps: found.flatMap((got) => got.maps), failed: found.flatMap((got) => got.failed) };
}

interface Sources {
  readonly coverageOf: CoverageOf;
  readonly coverageOfMany: CoverageOfMany | undefined;
}

interface CoverRun extends Sources {
  readonly read: Reader;
  /** The merge-base versions of the changed test files, run beside the originals, as they covered then. */
  readonly baseMaps: (tests: readonly ChangedFile[]) => Promise<readonly CoverageMap[]>;
}

const byPathThenStartRef = (a: FunctionRef, b: FunctionRef): number =>
  a.path.localeCompare(b.path) || a.start - b.start;

/**
 * The functions every changed test file covers, as it is at HEAD and as it was at the merge base (so a test
 * that dropped a call keeps the function it no longer calls in scope). A head version that cannot run is `fail`,
 * naming the first such file; a merge-base version that cannot run against the head is left out. The functions are
 * those any of the runs covered, ordered by file and line.
 */
async function coveredFunctions(tests: readonly ChangedFile[], run: CoverRun): Promise<Covered> {
  const heads = tests.filter((test) => test.status !== "deleted").map((test) => test.path);
  const head = await gather(heads, run.coverageOf, run.coverageOfMany);
  const [first] = head.failed;
  if (first !== undefined) {
    return { ok: false, reason: `could not run ${first} to find the functions it covers` };
  }
  const bases = await run.baseMaps(tests.filter((test) => test.status !== "added"));
  const refs = [...head.maps, ...bases].flatMap((map) => refsCovered(map, run.read));
  return { ok: true, refs: [...uniqueByKey(refs)].sort(byPathThenStartRef) };
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

interface Copy {
  /** The copy's path relative to the project, as the test runner is asked for it. */
  readonly name: string;
  readonly path: string;
}

/** The merge-base copy of one test file, written beside it so its imports resolve; undefined when the file is not at the merge base or the name is taken. */
async function copyOf(
  options: ScopeOptions,
  exec: Exec,
  mergeBase: string,
  test: string,
): Promise<Copy | undefined> {
  const shown = await showAt(exec, options.cwd, mergeBase, test);
  if (!shown.ok) return undefined;
  const name = copyName(test, (options.copyToken ?? randomToken)());
  const path = join(options.cwd, name);
  return createCopy(path, shown.value) ? { name, path } : undefined;
}

/** What a coverage source gives, or undefined for a run that throws. */
async function quietly<A>(
  run: (given: A) => Promise<CoverageMap | undefined>,
  given: A,
): Promise<CoverageMap | undefined> {
  try {
    return await run(given);
  } catch {
    return undefined;
  }
}

function quietMany(many: CoverageOfMany | undefined): CoverageOfMany | undefined {
  return many === undefined ? undefined : (group) => quietly(many, group);
}

/** Writes the merge-base copy of each test file that has one, adding each to `copies` as it is made. */
async function copyAll(
  copies: Copy[],
  options: ScopeOptions,
  exec: Exec,
  mergeBase: string,
  tests: readonly ChangedFile[],
): Promise<void> {
  for (const test of tests) {
    const copy = await copyOf(options, exec, mergeBase, test.path);
    if (copy !== undefined) copies.push(copy);
  }
}

/**
 * The coverage of the merge-base versions of the changed test files, each written beside the original under a name
 * that is never the original's, run together (file by file where that fails), and all removed whatever happens. Only a
 * file this created is removed; a path that is already taken means no run for that file.
 */
async function baseCoverage(
  options: ScopeOptions,
  exec: Exec,
  mergeBase: string,
  sources: Sources,
  tests: readonly ChangedFile[],
): Promise<readonly CoverageMap[]> {
  const copies: Copy[] = [];
  try {
    await copyAll(copies, options, exec, mergeBase, tests);
    const names = copies.map((copy) => copy.name);
    const got = await gather(
      names,
      (file) => quietly(sources.coverageOf, file),
      quietMany(sources.coverageOfMany),
    );
    return got.maps;
  } finally {
    for (const copy of copies) rmSync(copy.path, { force: true });
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

/** A source for a group of files: the caller's, else Vitest on the group, unless the caller gave a source for one file only. */
function manyOf(options: ScopeOptions, run: CoverageRun): CoverageOfMany | undefined {
  if (options.coverageOfMany !== undefined) return options.coverageOfMany;
  return options.coverageOf === undefined ? (group) => vitestCoverageOfMany(group, run) : undefined;
}

/** Where coverage comes from: what the caller gave, else Vitest runs. */
function sourcesOf(options: ScopeOptions, exec: Exec): Sources {
  const run = { cwd: options.cwd, exec, exclude: options.exclude ?? [] };
  return {
    coverageOf: options.coverageOf ?? ((test) => vitestCoverageOf(test, run)),
    coverageOfMany: manyOf(options, run),
  };
}

async function assemble(
  options: ScopeOptions,
  exec: Exec,
  mergeBase: string,
  files: readonly ChangedFile[],
): Promise<ScopeResult> {
  const read = readerFor(options.cwd);
  const coverage = sourcesOf(options, exec);
  const tests = files.filter((file) => isTestFile(file.path));
  const covered = await coveredFunctions(tests, {
    ...coverage,
    read,
    baseMaps: (changed) => baseCoverage(options, exec, mergeBase, coverage, changed),
  });
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
