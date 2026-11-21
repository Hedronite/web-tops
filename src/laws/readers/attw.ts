import { arrayOf, isRecord, parseJson, readOutput, str } from "../../layers/hygiene/tooling.ts";
import type { LawEntry, LawReader, LawReading } from "./types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { exitCodeOf, notEvaluated, readingOf } from "./reading.ts";

interface Problem {
  readonly kind: string;
  readonly entrypoint: string;
}

/** What gate 1 kept of attw: its exit code and each problem with the entry point it names. */
export interface AttwResult {
  readonly code: number | null;
  readonly problems: readonly Problem[];
}

function problemOf(item: unknown): Problem[] {
  return isRecord(item)
    ? [{ kind: str(item["kind"], "?"), entrypoint: str(item["entrypoint"], "?") }]
    : [];
}

export function readAttw(text: string | undefined): AttwResult | undefined {
  const value = parseJson(text);
  const code = isRecord(value) ? exitCodeOf(value["code"]) : undefined;
  if (!isRecord(value) || code === undefined) {
    return undefined;
  }
  return { code, problems: arrayOf(value["problems"]).flatMap(problemOf) };
}

const MISSING = "gate 1 kept no attw report: the package step did not run, or attw could not";

const findingOf = (problem: Problem): RawFinding => ({
  tool: "attw",
  rule: `attw:${problem.kind}`,
  verdict: "refuse",
  message: `entrypoint ${problem.entrypoint}`,
});

/** W-18, attw's half: each problem it found in the types of an entry point of the packed tarball. */
export function judgeAttw(
  law: LawEntry,
  result: AttwResult | undefined,
  held: boolean,
): LawReading {
  if (result === undefined) {
    return notEvaluated(law, MISSING);
  }
  if (result.problems.length === 0 && result.code !== 0) {
    return notEvaluated(law, `attw exited ${String(result.code)} and listed no problem`);
  }
  return readingOf(law, result.problems.map(findingOf), held);
}

/** The attw reader (W-18): it reads what gate 1 kept, and packs and checks nothing again. */
export const attwReader: LawReader = (input) => {
  const path = input.ctx.artifacts.get("attw-json");
  const result = path === undefined ? undefined : readAttw(readOutput(path));
  return Promise.resolve(input.laws.map((law) => judgeAttw(law, result, input.held)));
};
