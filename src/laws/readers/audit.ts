import { isRecord, parseJson, readOutput, records, str } from "../../layers/hygiene/tooling.ts";
import type { LawEntry, LawReader, LawReading } from "./types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { notEvaluated, readingOf } from "./reading.ts";

function advisoryId(advisory: Record<string, unknown>): string {
  const url = advisory["url"];
  return typeof url === "string" ? (url.split("/").pop() ?? url) : "advisory";
}

function advisoryFinding(name: string, advisory: Record<string, unknown>): RawFinding[] {
  const severity = advisory["severity"];
  // W-38 refuses a high or critical advisory in production dependencies.
  if (typeof severity !== "string" || !["high", "critical"].includes(severity)) {
    return [];
  }
  return [
    {
      tool: "audit",
      rule: advisoryId(advisory),
      verdict: "refuse",
      message: `${name}: ${str(advisory["title"], "advisory")} (${severity})`,
    },
  ];
}

/** The high and critical advisories of `bun audit --json` output: an object keyed by package, or undefined for any other text. */
export function readAdvisories(text: string | undefined): RawFinding[] | undefined {
  const report = parseJson(text);
  if (!isRecord(report)) {
    return undefined;
  }
  return Object.entries(report).flatMap(([name, advisories]) =>
    records(advisories).flatMap((advisory) => advisoryFinding(name, advisory)),
  );
}

const MISSING =
  "gate 1 wrote no bun audit report: the advisory registry was not reached, or the audit did not run";

/** W-38's reading of the advisories of gate 1's audit. */
export function judgeAudit(
  law: LawEntry,
  advisories: readonly RawFinding[] | undefined,
  held: boolean,
): LawReading {
  return advisories === undefined ? notEvaluated(law, MISSING) : readingOf(law, advisories, held);
}

/** The audit reader (W-38): it reads the report gate 1 kept, and queries no registry again. */
export const auditReader: LawReader = (input) => {
  const path = input.ctx.artifacts.get("audit-json");
  const advisories = path === undefined ? undefined : readAdvisories(readOutput(path));
  return Promise.resolve(input.laws.map((law) => judgeAudit(law, advisories, input.held)));
};
