import { isRecord, parseJson, readOutput, records } from "../../layers/hygiene/tooling.ts";
import type { RawFinding } from "../../report/findings.ts";
import { notEvaluated, readingOf } from "./reading.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";

interface HtmlReport {
  readonly pages: number;
  readonly findings: readonly Record<string, unknown>[];
}

const htmlFields = (
  parsed: Record<string, unknown>,
): { readonly pages: number; readonly findings: readonly unknown[] } | undefined =>
  typeof parsed["pages"] === "number" && Array.isArray(parsed["findings"])
    ? { pages: parsed["pages"], findings: parsed["findings"] }
    : undefined;

function readReport(text: string | undefined): HtmlReport | undefined {
  const parsed = parseJson(text);
  const fields = isRecord(parsed) ? htmlFields(parsed) : undefined;
  return fields === undefined
    ? undefined
    : { pages: fields.pages, findings: records(fields.findings) };
}

const lineField = (value: unknown): { readonly line?: number } =>
  typeof value === "number" && value >= 1 ? { line: value } : {};

function toFinding(entry: Record<string, unknown>): RawFinding | undefined {
  const rule = entry["rule"];
  const message = entry["message"];
  const file = entry["file"];
  const ok = typeof rule === "string" && typeof message === "string" && typeof file === "string";
  return ok
    ? { tool: "webtops", rule, verdict: "refuse", message, file, ...lineField(entry["line"]) }
    : undefined;
}

const mapFinding = (entry: Record<string, unknown>): RawFinding[] => {
  const finding = toFinding(entry);
  return finding === undefined ? [] : [finding];
};

function judgeLaw(report: HtmlReport, law: LawEntry): LawReading {
  if (report.pages === 0) {
    return notEvaluated(law, "no HTML pages were validated in html-report");
  }
  const mine = report.findings.filter((entry) => entry["law"] === law.id).flatMap(mapFinding);
  return readingOf(law, mine, false);
}

const MISSING =
  "the html-report artifact of gate 6 is missing or is not a valid html-validate JSON report";

/** The html-validate reader (W-20, W-22): reads `html-report` produced by gate 6. */
export const htmlValidateReader: LawReader = (input: ReadInput): Promise<readonly LawReading[]> => {
  const path = input.ctx.artifacts.get("html-report");
  const report = path === undefined ? undefined : readReport(readOutput(path));
  return Promise.resolve(
    input.laws.map((law) =>
      report === undefined ? notEvaluated(law, MISSING) : judgeLaw(report, law),
    ),
  );
};
