/** An inclusive range of 1-based line numbers. */
export interface LineRange {
  start: number;
  end: number;
}

export type ChangeStatus = "added" | "modified" | "deleted";

/** One file of a diff: the new-side lines it adds or changes, and where lines were only removed. */
export interface ChangedFile {
  readonly path: string;
  readonly status: ChangeStatus;
  readonly ranges: readonly LineRange[];
  /** New-side line numbers that a pure deletion (no added line beside it) follows. */
  readonly removedAfter: readonly number[];
}

/** A function of a file, keyed as WEB_TOPS.md section 6.7 says, over its inclusive line range. */
export interface FunctionSpan {
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

export interface FunctionRef extends FunctionSpan {
  readonly path: string;
}

/** A function's line range in an Istanbul `fnMap`, with the number of times it ran. */
export interface FunctionHit {
  readonly start: number;
  readonly end: number;
  readonly hits: number;
}

/** What one test run covered: file path to the functions the coverage tool saw. */
export type CoverageMap = ReadonlyMap<string, readonly FunctionHit[]>;

/** The diff of a run (WEB_TOPS.md section 6.4): the lines and functions to judge. */
export interface DiffScope {
  readonly mergeBase: string;
  readonly files: readonly ChangedFile[];
  /** Source functions that contain a changed line, or that a deletion was taken from. */
  readonly changedFunctions: readonly FunctionRef[];
  readonly testFiles: readonly string[];
  /** Source functions a changed test file runs. */
  readonly coveredFunctions: readonly FunctionRef[];
  /** Stryker `mutate` entries, `file:start-end`: the changed lines plus the covered functions, merged. */
  readonly mutate: readonly string[];
}

export type ScopeResult =
  | { readonly outcome: "scope"; readonly scope: DiffScope }
  | { readonly outcome: "vacuous"; readonly reason: string; readonly scope: DiffScope }
  | { readonly outcome: "fail"; readonly reason: string };
