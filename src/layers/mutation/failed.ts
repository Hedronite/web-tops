import type { ExecResult } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { failFinding, launchFailure, tail } from "../hygiene/tooling.ts";

/** The reason of a vacuous run: nothing in scope to mutate. */
export const VACUOUS = "no source file or function is in scope to mutate";

/** How many lines of what Stryker printed a failure quotes: the reason of a dry run is on stdout. */
export const OUT_LINES = 30;

/** How Stryker ended: its exit code, or the signal that ended it. */
const endOf = (result: ExecResult): string =>
  result.signal === undefined ? `exited ${String(result.code)}` : `was ended by ${result.signal}`;

/**
 * The finding for a Stryker run that ended without a report: `stryker exited N: <stderr>`, or the signal that ended
 * it, then the tail of stdout, where Stryker says what went wrong (a dry run, a timeout, the failing test).
 */
export function strykerFailed(result: ExecResult): RawFinding {
  const out = tail(result.stdout, OUT_LINES);
  const said = out === "" ? "" : `\nstdout (last ${String(OUT_LINES)} lines):\n${out}`;
  return failFinding(
    "stryker",
    "stryker-failed",
    `stryker ${endOf(result)}: ${tail(result.stderr)}${said}`,
  );
}

/** Why a Stryker run has no report to read: it did not start, or it ended badly; undefined when it exited 0. */
export function strykerTrouble(result: ExecResult): RawFinding | undefined {
  const launch = launchFailure("stryker", "stryker", result);
  if (launch !== undefined) {
    return launch;
  }
  return result.code === 0 ? undefined : strykerFailed(result);
}
