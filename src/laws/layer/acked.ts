import { ackFor, type Ack } from "../../acks/apply.ts";
import type { AckProblem } from "../../acks/collect.ts";
import { failed } from "../../census/finding.ts";
import type { RawFinding } from "../../report/findings.ts";
import type { LawEntry, LawReading } from "../readers/types.ts";

/** A refusal of a soft law (severity `A`) that lists the places that break it: the only reading an acknowledgement can change. */
const takesAck = (law: LawEntry, reading: LawReading): boolean =>
  law.severity === "A" && reading.verdict === "refuse" && reading.findings.length > 0;

/** A place an acknowledgement covers passes and carries the `ack` the report shows; any other is left as it is. */
function ackedPlace(
  law: LawEntry,
  finding: RawFinding,
  acks: readonly Ack[],
  today: string,
): RawFinding {
  const ack =
    finding.file === undefined
      ? undefined
      : ackFor(acks, law.id, finding.file, finding.line, today, (id) =>
          id === law.id ? law.severity : undefined,
        );
  return ack === undefined ? finding : { ...finding, verdict: "pass", ack };
}

/**
 * What an acknowledgement does to a soft law (WEB_TOPS.md sections 3.3 and 8.1). A reading that refuses a law of
 * severity `A` lists the places that break it; a place a comment (on its line or the line above) or a ledger entry (for
 * its file) acknowledges passes and carries its `ack`, and the reading passes when every place does. A law of severity
 * `R` is never acknowledged, and a reading that is not a refusal is left as it is.
 */
export function ackReading(
  law: LawEntry,
  reading: LawReading,
  acks: readonly Ack[],
  today: string,
): LawReading {
  if (!takesAck(law, reading)) return reading;
  const findings = reading.findings.map((finding) => ackedPlace(law, finding, acks, today));
  const open = findings.some((finding) => finding.ack === undefined);
  return { ...reading, findings, verdict: open ? "refuse" : "pass" };
}

/** The readings of every law, with the acknowledgements applied to those of the soft laws. */
export function ackAll(
  laws: readonly LawEntry[],
  byLaw: ReadonlyMap<string, readonly LawReading[]>,
  acks: readonly Ack[],
  today: string,
): Map<string, LawReading[]> {
  return new Map(
    laws.map((law) => [
      law.id,
      (byLaw.get(law.id) ?? []).map((reading) => ackReading(law, reading, acks, today)),
    ]),
  );
}

/** The problems of an acknowledgement that the laws layer says: one of a hard law or of an id that is no law (WEB_TOPS.md section 8.1). */
const LAW_RULES: ReadonlySet<string> = new Set(["ack-not-needed", "ack-unknown-law"]);

/** Those problems as failing findings, each at its comment's line or the ledger; the census says the others. */
export const lawAckFindings = (problems: readonly AckProblem[]): RawFinding[] =>
  problems
    .filter((problem) => LAW_RULES.has(problem.rule))
    .map((problem) =>
      failed(problem.rule, problem.message, {
        file: problem.file,
        ...(problem.line === undefined ? {} : { line: problem.line }),
      }),
    );
