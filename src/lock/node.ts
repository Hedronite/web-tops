type Version = readonly [number, number, number];

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
const CARET = /^\^([1-9]\d*)\.(\d+)\.(\d+)$/;
const AT_LEAST = /^>=(\d+)(?:\.(\d+)\.(\d+))?$/;

function toVersion(parts: readonly (string | undefined)[]): Version {
  return [Number(parts[0]), Number(parts[1] ?? 0), Number(parts[2] ?? 0)];
}

function parseVersion(text: string): Version | undefined {
  const match = VERSION.exec(text);
  return match === null ? undefined : toVersion(match.slice(1));
}

function atLeast(version: Version, floor: Version): boolean {
  const [a, b, c] = version;
  const [x, y, z] = floor;
  if (a !== x) return a > x;
  return b !== y ? b > y : c >= z;
}

/** The test one clause stands for, or undefined for a clause this reader does not know. */
function clauseTest(clause: string): ((version: Version) => boolean) | undefined {
  const caret = CARET.exec(clause);
  if (caret !== null) {
    const floor = toVersion(caret.slice(1));
    return (version) => version[0] === floor[0] && atLeast(version, floor);
  }
  const least = AT_LEAST.exec(clause);
  if (least === null) return undefined;
  const floor = toVersion(least.slice(1));
  return (version) => atLeast(version, floor);
}

const clausesOf = (range: string): string[] => range.split("||").map((clause) => clause.trim());

/** Whether `text` is a Node range this reader can evaluate: `^x.y.z` (a non-zero major) and `>=n` clauses joined by `||`. */
export function isNodeRange(text: string): boolean {
  return clausesOf(text).every((clause) => clauseTest(clause) !== undefined);
}

/**
 * Whether a Node version (`24.15.0` or `v24.15.0`) is inside a range of `^x.y.z` and `>=n`
 * clauses, which is every range WEB_TOPS.md section 2 writes. An unreadable version or range is
 * outside it.
 */
export function satisfiesNodeRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  if (parsed === undefined || !isNodeRange(range)) return false;
  return clausesOf(range).some((clause) => clauseTest(clause)?.(parsed) === true);
}
