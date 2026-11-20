import type { RawFinding } from "../../report/findings.ts";
import type { Verdict } from "../../report/types.ts";
import { isRequired, toolsOf } from "./entries.ts";
import type { LawEntry, LawReading } from "../../laws/readers/types.ts";

/** Worst first: the one verdict a law has when its readers disagree. A law passes only when every reader passes. */
function worstFirst(): readonly Verdict[] {
  return ["refuse", "fail", "ack-missing", "not-evaluated", "pass"];
}

/** The worse of two verdicts. */
export const worse = (left: Verdict, right: Verdict): Verdict =>
  worstFirst().find((verdict) => verdict === left || verdict === right) ?? left;

/** Why a law with no tool rules to read has no reading: its reader is not built, or it is judged by review. */
function unreadReason(law: LawEntry): string {
  if (law.reader === "at") {
    return "judged by attestation, and none is recorded";
  }
  return law.reader === "tbd" ? "no reader is built for it yet" : `${law.id} has no reader yet`;
}

const unread = (law: LawEntry, reason: string): LawReading => ({
  law: law.id,
  verdict: "not-evaluated",
  reason,
  findings: [],
});

/**
 * What every tool a law maps comes to: the readings its readers gave, and a `not-evaluated` for each tool with no
 * reader. A law that maps no tool has one reading, saying why it has none.
 */
export function readingsOf(
  law: LawEntry,
  given: readonly LawReading[],
  read: ReadonlySet<string>,
): LawReading[] {
  const tools = toolsOf(law);
  if (tools.length === 0) {
    return [unread(law, unreadReason(law))];
  }
  const missing = tools.filter((tool) => !read.has(tool));
  return [...given, ...missing.map((tool) => unread(law, `${tool} has no reader yet`))];
}

/** A break of a law whose severity is `A` needs an acknowledgement; of one whose severity is `R`, it is a refusal. */
const forSeverity = (law: LawEntry, verdict: Verdict): Verdict =>
  law.severity === "A" && verdict === "refuse" ? "ack-missing" : verdict;

/**
 * A law that is not required is counted and printed, and never ends the run: a break is `not-evaluated`, not a refusal
 * (section 3.3). A tool that could not run is still a failure.
 */
function forRequirement(required: boolean, verdict: Verdict): Verdict {
  return !required && (verdict === "refuse" || verdict === "ack-missing")
    ? "not-evaluated"
    : verdict;
}

export interface Judged {
  readonly law: LawEntry;
  readonly required: boolean;
  readonly verdict: Verdict;
  readonly readings: readonly LawReading[];
}

/** One law's verdict over its readings, as its severity and the class's requirement make it. */
export function judgeEntry(
  law: LawEntry,
  className: string,
  readings: readonly LawReading[],
): Judged {
  const required = isRequired(law, className);
  const combined = readings.map((reading) => reading.verdict).reduce(worse, "pass");
  const verdict = forRequirement(required, forSeverity(law, combined));
  return { law, required, verdict, readings };
}

const notes = (readings: readonly LawReading[]): string[] =>
  readings.flatMap((reading) => (reading.note === undefined ? [] : [reading.note]));

const reasons = (readings: readonly LawReading[]): string[] =>
  readings.flatMap((reading) => (reading.reason === undefined ? [] : [reading.reason]));

/** The one sentence a law's finding says. */
export function sentence(judged: Judged): string {
  const { law, readings } = judged;
  const places = readings.reduce((total, reading) => total + reading.findings.length, 0);
  const detail = [...notes(readings), ...reasons(readings)].join("; ");
  const where = places > 0 ? `${String(places)} place(s) listed` : "";
  const extra = [detail, where].filter((part) => part !== "").join("; ");
  return extra === "" ? `${law.id} ${judged.verdict}` : `${law.id} ${judged.verdict}: ${extra}`;
}

/** The finding that is the law's own verdict: one for every mapped law, so the counts can be read back from the findings. */
export function lawFinding(judged: Judged): RawFinding {
  return {
    tool: "webtops",
    rule: `law/${judged.law.id}`,
    law: judged.law.id,
    verdict: judged.verdict,
    message: sentence(judged),
    required: judged.required,
  };
}

/** The places a law is broken, as findings that carry the law's verdict and whether it is required. */
export function evidenceOf(judged: Judged): RawFinding[] {
  const verdict = judged.verdict;
  return judged.readings
    .flatMap((reading) => reading.findings)
    .map((finding) => ({ ...finding, verdict, required: judged.required }));
}
