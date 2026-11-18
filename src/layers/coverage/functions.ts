import { isRecord } from "../hygiene/tooling.ts";

/** What `cov(f)` needs from a function: its place, its own hit count and the statements in its body (WEB_TOPS.md section 6.2). */
export interface FunctionCoverage {
  readonly file: string;
  /** The name the coverage tool gave it, `(anonymous_N)` for an arrow with none. */
  readonly name: string;
  readonly line: number;
  readonly column: number;
  /** How often the function ran. */
  readonly hits: number;
  /** Statements that start inside the function's span, those of nested functions included. */
  readonly statements: number;
  readonly covered: number;
  /** Statement coverage of the body, 0 when the function never ran. */
  readonly cov: number;
}

interface Position {
  readonly line: number;
  /** An end column of null is the end of its line. */
  readonly column: number | null;
}

interface Span {
  readonly start: Position;
  readonly end: Position;
}

function positionOf(value: unknown): Position | undefined {
  if (!isRecord(value) || typeof value["line"] !== "number") {
    return undefined;
  }
  const column = value["column"];
  return { line: value["line"], column: typeof column === "number" ? column : null };
}

function spanOf(value: unknown): Span | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const start = positionOf(value["start"]);
  const end = positionOf(value["end"]);
  return start === undefined || end === undefined ? undefined : { start, end };
}

function columnOf(position: Position): number {
  return position.column ?? 0;
}

function startsAfter(position: Position, start: Position): boolean {
  return (
    position.line > start.line ||
    (position.line === start.line && columnOf(position) >= columnOf(start))
  );
}

function endsBefore(position: Position, end: Position): boolean {
  if (position.line !== end.line) {
    return position.line < end.line;
  }
  return end.column === null || columnOf(position) <= end.column;
}

function inside(position: Position, span: Span): boolean {
  return startsAfter(position, span.start) && endsBefore(position, span.end);
}

interface Statement {
  readonly start: Position;
  readonly hits: number;
}

function hitCount(counts: unknown, id: string): number {
  const value = isRecord(counts) ? counts[id] : undefined;
  return typeof value === "number" ? value : 0;
}

function statementsOf(entry: Record<string, unknown>): Statement[] {
  const map = entry["statementMap"];
  const found = isRecord(map) ? Object.keys(map) : [];
  return found.flatMap((id): Statement[] => {
    const span = spanOf(isRecord(map) ? map[id] : undefined);
    return span === undefined ? [] : [{ start: span.start, hits: hitCount(entry["s"], id) }];
  });
}

function shareOf(hits: number, within: readonly Statement[]): number {
  if (hits === 0) {
    return 0;
  }
  return within.length === 0 ? 1 : within.filter((item) => item.hits > 0).length / within.length;
}

const nameOf = (fn: unknown): string =>
  isRecord(fn) && typeof fn["name"] === "string" ? fn["name"] : "(anonymous)";

/** The row of one entry of a file's function map, or none when the entry is not an object or has no readable body. */
function describeFunction(
  file: string,
  fn: unknown,
  hits: number,
  statements: readonly Statement[],
): FunctionCoverage | undefined {
  const span = spanOf(isRecord(fn) ? fn["loc"] : undefined);
  if (span === undefined) {
    return undefined;
  }
  const within = statements.filter((item) => inside(item.start, span));
  const covered = within.filter((item) => item.hits > 0).length;
  const { line, column } = { line: span.start.line, column: span.start.column ?? 0 };
  return {
    file,
    name: nameOf(fn),
    line,
    column,
    hits,
    statements: within.length,
    covered,
    cov: shareOf(hits, within),
  };
}

function fileFunctions(file: string, entry: unknown): FunctionCoverage[] {
  if (!isRecord(entry) || !isRecord(entry["fnMap"])) {
    return [];
  }
  const statements = statementsOf(entry);
  return Object.entries(entry["fnMap"]).flatMap(
    ([id, fn]) => describeFunction(file, fn, hitCount(entry["f"], id), statements) ?? [],
  );
}

/** The span of every function in a file's coverage entry. */
function functionSpans(entry: Record<string, unknown>): Span[] {
  const map = entry["fnMap"];
  const found = isRecord(map) ? Object.values(map) : [];
  return found.flatMap((fn): Span[] => {
    const span = isRecord(fn) ? spanOf(fn["loc"]) : undefined;
    return span === undefined ? [] : [span];
  });
}

/**
 * Statement coverage of the code outside every function (the `<module>` pseudo-function, section 6.7): 1 when
 * there is no such statement, and 0 when the run never reported the file.
 */
export function moduleCoverage(entry: unknown): number {
  if (!isRecord(entry)) {
    return 0;
  }
  const spans = functionSpans(entry);
  const outside = statementsOf(entry).filter(
    (item) => !spans.some((span) => inside(item.start, span)),
  );
  return shareOf(1, outside);
}

function bySource(left: FunctionCoverage, right: FunctionCoverage): number {
  return left.line - right.line || left.column - right.column;
}

/**
 * Statement coverage per function from a `coverage-final.json`: the share of statements inside the function's span
 * that ran, and 0 when the function itself never ran, so a one-line arrow that nothing calls does not read as
 * covered because its declaration did (E2). Files by name, functions in source order.
 */
export function functionCoverage(coverage: unknown): FunctionCoverage[] {
  if (!isRecord(coverage) || Array.isArray(coverage)) {
    return [];
  }
  return Object.keys(coverage)
    .sort()
    .flatMap((file) => fileFunctions(file, coverage[file]).sort(bySource));
}
