import { readLockFile } from "../../lock/config.ts";
import { lockProblems } from "../../lock/verify.ts";
import type { LawReader, ReadInput } from "./types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { readingOf, webtopsRefusal } from "./reading.ts";

/** W-41: what differs between `web-tops.lock` and the tools installed, as one finding for each difference. */
export function lockFindings(cwd: string, env: ReadInput["ctx"]["env"]): RawFinding[] {
  const read = readLockFile(cwd);
  if (read.state === "absent") {
    return [webtopsRefusal("lock-missing", "no web-tops.lock is committed", "web-tops.lock")];
  }
  if (read.state === "invalid") {
    return [webtopsRefusal("lock-unreadable", read.error, "web-tops.lock")];
  }
  return lockProblems(read.lock, cwd, env).map((problem) =>
    webtopsRefusal("lock-mismatch", problem, "web-tops.lock"),
  );
}

/** The lock reader (W-41): the installed tool versions against `web-tops.lock`, as `webtops lock --verify` reads them. */
export const lockReader: LawReader = (input) => {
  const findings = lockFindings(input.ctx.cwd, input.ctx.env);
  return Promise.resolve(input.laws.map((law) => readingOf(law, findings, false)));
};
