import { isRecord, parseJson, readOutput } from "../../layers/hygiene/tooling.ts";
import type { RawFinding } from "../../report/findings.ts";
import { exitCodeOf, notEvaluated, readingOf } from "./reading.ts";
import type { LawEntry, LawReader, LawReading } from "./types.ts";

/** The exit code of gate 1's `astro check`, or undefined when gate 1 kept none. */
function checkCode(text: string | undefined): number | null | undefined {
  const report = parseJson(text);
  return isRecord(report) ? exitCodeOf(report["code"]) : undefined;
}

const MISSING = "gate 1 kept no result of astro check: the step did not run";

const broken = (code: number | null): RawFinding => ({
  tool: "astro",
  rule: "astro check",
  verdict: "refuse",
  message: `astro check exited ${String(code)}`,
});

/**
 * W-27: `astro check` ran in gate 1 and exited 0. A failed step is no counted finding, as it names no file, so no
 * ratchet holds it (section 6.7).
 */
export function judgeAstroCheck(law: LawEntry, text: string | undefined): LawReading {
  const code = checkCode(text);
  if (code === undefined) {
    return notEvaluated(law, MISSING);
  }
  return readingOf(law, code === 0 ? [] : [broken(code)], false);
}

/** The `astro check` reader (W-27): the result gate 1 kept; it does not run the check again. */
export const astroCheckReader: LawReader = (input) => {
  const path = input.ctx.artifacts.get("astro-check-json");
  const text = path === undefined ? undefined : readOutput(path);
  return Promise.resolve(input.laws.map((law) => judgeAstroCheck(law, text)));
};
