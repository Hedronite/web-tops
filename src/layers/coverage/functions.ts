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

function describeFunction(
  file: string,
  fn: Record<string, unknown>,
  hits: number,
  statements: readonly Statement[],
): FunctionCoverage | undefined {
  const span = spanOf(fn["loc"]);
  if (span === undefined) {
    return undefined;
  }
  const within = statements.filter((item) => inside(item.start, span));
  const name = typeof fn["name"] === "string" ? fn["name"] : "(anonymous)";
  const covered = within.filter((item) => item.hits > 0).length;
  const { line, column } = { line: span.start.line, column: span.start.column ?? 0 };
  return {
    file,
    name,
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
  const fnMap = entry["fnMap"];
  const statements = statementsOf(entry);
  return Object.keys(fnMap).flatMap((id) => {
    const fn = fnMap[id];
    const row = isRecord(fn)
      ? describeFunction(file, fn, hitCount(entry["f"], id), statements)
      : undefined;
    return row === undefined ? [] : [row];
  });
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
