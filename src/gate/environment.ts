export interface Versions {
  readonly bun?: string;
  readonly node: string;
}

/** Section 2: Bun 1.4 is the runtime; Node 22.23.4 is the floor where a project runs on Node. */
const BUN_FLOOR = "1.4.0";
const NODE_FLOOR = "22.23.4";

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
  if (versions.bun !== undefined) {
    return isBelow(versions.bun, BUN_FLOOR) ? [`Bun ${versions.bun} is below ${BUN_FLOOR}`] : [];
  }
  return isBelow(versions.node, NODE_FLOOR) ? [`Node ${versions.node} is below ${NODE_FLOOR}`] : [];
}
