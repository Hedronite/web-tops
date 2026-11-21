import { tail } from "../../layers/hygiene/tooling.ts";
import type { ExecResult } from "../../gate/types.ts";
import type { LawEntry, LawReading } from "./types.ts";
import type { RawFinding } from "../../report/findings.ts";

/** A law the reader could not judge, with the reason: never a pass (WEB_TOPS.md section 3.3). */
export const notEvaluated = (law: LawEntry, reason: string): LawReading => ({
  law: law.id,
  verdict: "not-evaluated",
  reason,
  findings: [],
});

/** A refusal the gate says itself (tool `webtops`), at a file. */
export const webtopsRefusal = (rule: string, message: string, file: string): RawFinding => ({
  tool: "webtops",
  rule,
  verdict: "refuse",
  message,
  file,
});

/** The names of the rules of one tool that a law maps. */
export const rulesOf = (law: LawEntry, tool: string): string[] =>
  law.rules.filter((rule) => rule.tool === tool).map((rule) => rule.name);

/**
 * A reading over the places that break a law. A break is `refuse` (the judge turns it into `ack-missing` for a soft
 * law); under a ratchet the breaks gate 1 already counted are held by the baseline, and the count is the ratchet's
 * to refuse (section 6.7), so they read as a pass that says so.
 */
export function readingOf(law: LawEntry, breaks: readonly RawFinding[], held: boolean): LawReading {
  if (breaks.length === 0) {
    return { law: law.id, verdict: "pass", findings: [] };
  }
  if (held) {
    return {
      law: law.id,
      verdict: "pass",
      findings: [],
      note: `${String(breaks.length)} held by the baseline`,
    };
  }
  return { law: law.id, verdict: "refuse", findings: breaks };
}

/** An exit code as a report keeps it: a number, or null for a process that never exited; anything else is undefined. */
export const exitCodeOf = (value: unknown): number | null | undefined =>
  typeof value === "number" || value === null ? value : undefined;

/** A scanner that ended 0 (clean) or 1 (findings) gave an answer; any other end is none. */
export const gaveAnswer = (result: ExecResult): boolean => result.code === 0 || result.code === 1;

/** The last lines a tool printed when it said something other than an answer: stderr, else stdout. */
export const saidOf = (result: ExecResult): string =>
  tail(result.stderr === "" ? result.stdout : result.stderr, 2);
