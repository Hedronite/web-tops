export interface Versions {
  /** Absent when the gate does not run under Bun. */
  readonly bun?: string;
}

/** Section 2: Bun 1.4 is the runtime. The Node range is checked by the lock and `doctor`, not by `gate` (R36). */
const BUN_FLOOR = "1.4.0";

function parts(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function isBelow(version: string, floor: string): boolean {
  const have = parts(version);
  const want = parts(floor);
  for (const [index, needed] of want.entries()) {
    const got = have[index] ?? 0;
    if (got !== needed) {
      return got < needed;
    }
  }
  return false;
}

/** Environment errors found before any layer runs (exit 3, WEB_TOPS.md section 12). */
export function checkEnvironment(versions: Versions): string[] {
  const bun = versions.bun;
  return bun !== undefined && isBelow(bun, BUN_FLOOR) ? [`Bun ${bun} is below ${BUN_FLOOR}`] : [];
}
