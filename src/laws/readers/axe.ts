import { isRecord, parseJson, readOutput } from "../../layers/hygiene/tooling.ts";
import type { RawFinding } from "../../report/findings.ts";
import { notEvaluated, readingOf, rulesOf } from "./reading.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";

/** One element a rule reported, as the axe layer writes it. */
interface AxeEntry {
  readonly rule: string;
  readonly selector: string;
  readonly impact?: unknown;
  readonly file?: unknown;
}

interface AxeReport {
  readonly routes: readonly unknown[];
  readonly violations: readonly AxeEntry[];
  readonly incomplete: readonly AxeEntry[];
}

const isEntry = (entry: unknown): entry is AxeEntry =>
  isRecord(entry) && typeof entry["rule"] === "string" && typeof entry["selector"] === "string";

const entriesOf = (list: unknown): readonly AxeEntry[] | undefined =>
  Array.isArray(list) && list.every(isEntry) ? list : undefined;

/** The whole report, or none: an entry that cannot be read leaves it unread, never dropped from it. */
function reportOf(parsed: Record<string, unknown>): AxeReport | undefined {
  const routes: unknown = parsed["routes"];
  const violations = entriesOf(parsed["violations"]);
  const incomplete = entriesOf(parsed["incomplete"]);
  return Array.isArray(routes) && violations !== undefined && incomplete !== undefined
    ? { routes, violations, incomplete }
    : undefined;
}

function readReport(text: string | undefined): AxeReport | undefined {
  const parsed = parseJson(text);
  return isRecord(parsed) ? reportOf(parsed) : undefined;
}

const isFailingImpact = (entry: AxeEntry): boolean =>
  entry.impact !== "moderate" && entry.impact !== "minor";

const matchesLaw = (entry: AxeEntry, targetOnly: boolean): boolean =>
  (entry.rule === "target-size") === targetOnly;

const fileField = (value: unknown): { readonly file?: string } =>
  typeof value === "string" && value !== "" ? { file: value } : {};

const toFinding = (entry: AxeEntry): RawFinding => ({
  tool: "webtops",
  rule: `axe:${entry.rule}`,
  verdict: "refuse",
  message: `axe ${entry.rule} at ${entry.selector}`,
  ...fileField(entry.file),
});

function failingBreaks(report: AxeReport, targetOnly: boolean): RawFinding[] {
  return report.violations
    .filter((entry) => matchesLaw(entry, targetOnly) && isFailingImpact(entry))
    .map(toFinding);
}

/** A failing violation refuses; else a result axe left incomplete is not evaluated, never a pass (section 7). */
function judgeLaw(report: AxeReport, law: LawEntry): LawReading {
  if (report.routes.length === 0) {
    return notEvaluated(law, "no routes were evaluated in axe-report");
  }
  const targetOnly = rulesOf(law, "axe").includes("target-size");
  const breaks = failingBreaks(report, targetOnly);
  const open = report.incomplete.filter((entry) => matchesLaw(entry, targetOnly));
  return breaks.length === 0 && open.length > 0
    ? notEvaluated(law, `axe left ${String(open.length)} result(s) incomplete`)
    : readingOf(law, breaks, false);
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
