import { isRecord, parseJson, readOutput } from "../../layers/hygiene/tooling.ts";
import type { RawFinding } from "../../report/findings.ts";
import { notEvaluated, readingOf } from "./reading.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";

/** One error as the html layer writes it: the law it breaks, the rule, what it said and the page. */
interface HtmlEntry {
  readonly law: string;
  readonly rule: string;
  readonly message: string;
  readonly file: string;
  readonly line?: unknown;
}

interface HtmlReport {
  readonly pages: number;
  readonly findings: readonly HtmlEntry[];
}

const isEntry = (entry: unknown): entry is HtmlEntry =>
  isRecord(entry) &&
  ["law", "rule", "message", "file"].every((key) => typeof entry[key] === "string");

/** The whole report, or none: a finding that cannot be read leaves it unread, never dropped from it. */
function reportOf(pages: unknown, findings: unknown): HtmlReport | undefined {
  return typeof pages === "number" && Array.isArray(findings) && findings.every(isEntry)
    ? { pages, findings }
    : undefined;
}

function readReport(text: string | undefined): HtmlReport | undefined {
  const parsed = parseJson(text);
  return isRecord(parsed) ? reportOf(parsed["pages"], parsed["findings"]) : undefined;
}

const lineField = (value: unknown): { readonly line?: number } =>
  typeof value === "number" && value >= 1 ? { line: value } : {};

const toFinding = (entry: HtmlEntry): RawFinding => ({
  tool: "webtops",
  rule: entry.rule,
  verdict: "refuse",
  message: entry.message,
  file: entry.file,
  ...lineField(entry.line),
});

function judgeLaw(report: HtmlReport, law: LawEntry): LawReading {
  if (report.pages === 0) {
    return notEvaluated(law, "no HTML pages were validated in html-report");
  }
  const mine = report.findings.filter((entry) => entry.law === law.id).map(toFinding);
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
