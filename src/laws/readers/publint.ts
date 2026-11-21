import { arrayOf, isRecord, parseJson, readOutput } from "../../layers/hygiene/tooling.ts";
import type { LawEntry, LawReader, LawReading } from "./types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { exitCodeOf, notEvaluated, readingOf } from "./reading.ts";

/** What gate 1 kept of publint: its exit code and the errors it listed. */
export interface PublintResult {
  readonly code: number | null;
  readonly errors: readonly string[];
}

export function readPublint(text: string | undefined): PublintResult | undefined {
  const value = parseJson(text);
  const code = isRecord(value) ? exitCodeOf(value["code"]) : undefined;
  if (!isRecord(value) || code === undefined) {
    return undefined;
  }
  return { code, errors: arrayOf(value["errors"]).filter((item) => typeof item === "string") };
}

const MISSING = "gate 1 kept no publint report: the package step did not run, or publint could not";

const findingOf = (message: string): RawFinding => ({
  tool: "publint",
  rule: "publint",
  verdict: "refuse",
  message,
});

/** W-18, publint's half: each error it listed on the packed tarball. */
export function judgePublint(
  law: LawEntry,
  result: PublintResult | undefined,
  held: boolean,
): LawReading {
  if (result === undefined) {
    return notEvaluated(law, MISSING);
  }
  if (result.errors.length === 0 && result.code !== 0) {
    return notEvaluated(law, `publint exited ${String(result.code)} and listed no error`);
  }
  return readingOf(law, result.errors.map(findingOf), held);
}

/** The publint reader (W-18): it reads what gate 1 kept, and packs and lints nothing again. */
export const publintReader: LawReader = (input) => {
  const path = input.ctx.artifacts.get("publint-json");
  const result = path === undefined ? undefined : readPublint(readOutput(path));
  return Promise.resolve(input.laws.map((law) => judgePublint(law, result, input.held)));
};
