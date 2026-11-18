import type { DiffScope } from "../diff/types.ts";
import type { CrapRow } from "./score.ts";

/** An inclusive range of 1-based lines. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** A range to judge; `module` marks the span of a changed `<module>`, which is the whole file but judges the module row alone. */
export interface ChangedRange extends LineRange {
  readonly module?: boolean;
}

/** The lines to judge, by project-relative file. */
export type ChangedRanges = ReadonlyMap<string, readonly ChangedRange[]>;

const MODULE_KEY = "::<module>";

/** The span of each function the diff changed, by file: a changed line, or a deletion taken from it (section 6.4). */
export function changedRanges(scope: DiffScope): ChangedRanges {
  const ranges = new Map<string, ChangedRange[]>();
  for (const fn of scope.changedFunctions) {
    const range: ChangedRange = fn.key.endsWith(MODULE_KEY)
      ? { start: fn.start, end: fn.end, module: true }
      : { start: fn.start, end: fn.end };
    ranges.set(fn.path, [...(ranges.get(fn.path) ?? []), range]);
  }
  return ranges;
}

/** A `<module>` row is judged when `<module>` changed, and a function row when a changed function overlaps it. */
function touches(row: CrapRow, ranges: readonly ChangedRange[]): boolean {
  const isModule = row.key.endsWith(MODULE_KEY);
  return ranges.some((range) =>
    isModule
      ? range.module === true
      : range.module !== true && range.start <= row.endLine && range.end >= row.line,
  );
}

/** The functions a changed range falls inside (the diff's scope, section 6.2). A file the diff does not name has none. */
export function touched(rows: readonly CrapRow[], changed: ChangedRanges): CrapRow[] {
  return rows.filter((row) => touches(row, changed.get(row.file) ?? []));
}
