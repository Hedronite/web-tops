import { arrayOf, isRecord, parseJson, readOutput, records } from "../../layers/hygiene/tooling.ts";
import type { RawFinding } from "../../report/findings.ts";
import { notEvaluated, readingOf, rulesOf } from "./reading.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";

interface AxeReport {
  readonly routes: readonly unknown[];
  readonly violations: readonly Record<string, unknown>[];
  readonly incomplete: readonly Record<string, unknown>[];
}

const isAxeShape = (parsed: Record<string, unknown>): boolean =>
  Array.isArray(parsed["routes"]) &&
  Array.isArray(parsed["violations"]) &&
  Array.isArray(parsed["incomplete"]);

function readReport(text: string | undefined): AxeReport | undefined {
  const parsed = parseJson(text);
  if (!isRecord(parsed) || !isAxeShape(parsed)) return undefined;
  return {
    routes: arrayOf(parsed["routes"]),
    violations: records(parsed["violations"]),
    incomplete: records(parsed["incomplete"]),
  };
}

const isFailingImpact = (entry: Record<string, unknown>): boolean =>
  entry["impact"] !== "moderate" && entry["impact"] !== "minor";

function matchesLaw(entry: Record<string, unknown>, targetOnly: boolean): boolean {
  const isTarget = entry["rule"] === "target-size";
  return targetOnly ? isTarget : !isTarget;
}

const fileField = (value: unknown): { readonly file?: string } =>
  typeof value === "string" && value !== "" ? { file: value } : {};

function toFinding(entry: Record<string, unknown>): RawFinding | undefined {
  const rule = entry["rule"];
  const selector = entry["selector"];
  if (typeof rule !== "string" || typeof selector !== "string") return undefined;
  return {
    tool: "webtops",
    rule: `axe:${rule}`,
    verdict: "refuse",
    message: `axe ${rule} at ${selector}`,
    ...fileField(entry["file"]),
  };
}

const mapFinding = (entry: Record<string, unknown>): RawFinding[] => {
  const finding = toFinding(entry);
  return finding === undefined ? [] : [finding];
};

function failingBreaks(report: AxeReport, targetOnly: boolean): RawFinding[] {
  return report.violations
    .filter((entry) => matchesLaw(entry, targetOnly) && isFailingImpact(entry))
    .flatMap(mapFinding);
}

function judgeLaw(report: AxeReport, law: LawEntry): LawReading {
  if (report.routes.length === 0) {
    return notEvaluated(law, "no routes were evaluated in axe-report");
  }
  const targetOnly = rulesOf(law, "axe").includes("target-size");
  const incomplete = report.incomplete.filter((entry) => matchesLaw(entry, targetOnly));
  return incomplete.length > 0
    ? notEvaluated(law, `axe left ${String(incomplete.length)} result(s) incomplete`)
    : readingOf(law, failingBreaks(report, targetOnly), false);
}

const MISSING = "the axe-report artifact of gate 6 is missing or is not a valid axe JSON report";

/** The axe reader (W-21, W-22 built-page, W-44 target-size): reads `axe-report` produced by gate 6. */
export const axeReader: LawReader = (input: ReadInput): Promise<readonly LawReading[]> => {
  const path = input.ctx.artifacts.get("axe-report");
  const report = path === undefined ? undefined : readReport(readOutput(path));
  return Promise.resolve(
    input.laws.map((law) =>
      report === undefined ? notEvaluated(law, MISSING) : judgeLaw(report, law),
    ),
  );
};
