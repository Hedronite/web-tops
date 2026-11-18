import type { DiffScope } from "../diff/types.ts";
import type { CrapRow } from "./score.ts";

/** An inclusive range of 1-based lines. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** The lines to judge, by project-relative file. */
export type ChangedRanges = ReadonlyMap<string, readonly LineRange[]>;

/** The span of each function the diff changed, by file: a changed line, or a deletion taken from it (section 6.4). */
export function changedRanges(scope: DiffScope): ChangedRanges {
  const ranges = new Map<string, LineRange[]>();
  for (const fn of scope.changedFunctions) {
    ranges.set(fn.path, [...(ranges.get(fn.path) ?? []), { start: fn.start, end: fn.end }]);
  }
  return ranges;
}

function touches(row: CrapRow, ranges: readonly LineRange[]): boolean {
  return ranges.some((range) => range.start <= row.endLine && range.end >= row.line);
}

/** The functions a changed range falls inside (the diff's scope, section 6.2). A file the diff does not name has none. */
export function touched(rows: readonly CrapRow[], changed: ChangedRanges): CrapRow[] {
  return rows.filter((row) => touches(row, changed.get(row.file) ?? []));
}
