export interface LcovTotals {
  /** Source files with a record. */
  readonly files: number;
  /** Instrumented lines (`LF`). */
  readonly found: number;
  /** Lines that ran (`LH`). */
  readonly hit: number;
}

/** One `SF:` record of an LCOV profile. */
export interface LcovRecord {
  readonly file: string;
  readonly found: number;
  readonly hit: number;
}

function sum(lines: readonly string[], prefix: string): number {
  return lines
    .filter((line) => line.startsWith(prefix))
    .reduce((total, line) => total + (Number.parseInt(line.slice(prefix.length), 10) || 0), 0);
}

function recordOf(chunk: string): LcovRecord {
  const lines = chunk.split("\n");
  return { file: (lines[0] ?? "").trim(), found: sum(lines, "LF:"), hit: sum(lines, "LH:") };
}

/** The records of an LCOV profile. A record without `LF` and `LH` counts as a file with no lines. */
export function parseRecords(text: string): LcovRecord[] {
  return text.split(/^SF:/mu).slice(1).map(recordOf);
}

/** Sums the line counts of the given records. */
export function totalsOf(records: readonly LcovRecord[]): LcovTotals {
  return {
    files: records.length,
    found: records.reduce((total, record) => total + record.found, 0),
    hit: records.reduce((total, record) => total + record.hit, 0),
  };
}

/** Percent of lines hit, to two places, for messages; comparisons use integers (`isBelow`). */
export function percent(totals: LcovTotals): string {
  return totals.found === 0 ? "0" : ((totals.hit * 100) / totals.found).toFixed(2);
}

/** True when the hit lines are under the floor, with no floating-point rounding at the boundary. */
export function isBelow(totals: LcovTotals, floor: number): boolean {
  return totals.hit * 100 < floor * totals.found;
}
