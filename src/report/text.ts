import { CENSUS_RULE_PREFIX } from "../census/kinds.ts";
import { hasRun, type Finding, type Report, type ReportLayer } from "./types.ts";

const REQUIRED_BY = /^(?:(.+) \()?required by ([^)]+?)\)?$/u;

interface Required {
  /** The reason with the "required by" part taken out. */
  readonly rest: string | undefined;
  readonly by: string;
}

function parseRequired(reason: string | undefined): Required | undefined {
  const match = reason === undefined ? null : REQUIRED_BY.exec(reason);
  if (match === null) {
    return undefined;
  }
  const by = match[2];
  return by === undefined ? undefined : { rest: match[1], by };
}

/** The reason with a trailing "required by X" taken out, and the name that goes beside the layer id. */
function split(layer: ReportLayer): { name: string; reason: string | undefined } {
  const parsed = parseRequired(layer.reason);
  return parsed === undefined
    ? { name: layer.id, reason: layer.reason }
    : { name: `${layer.id} (required by ${parsed.by})`, reason: parsed.rest };
}

function placeOf(finding: Finding): string {
  const file = finding.file ?? "";
  const where = finding.line === null ? file : `${file}:${String(finding.line)}`;
  return where === "" ? "" : ` (${where})`;
}

function findingLine(finding: Finding): string {
  return `      - [${finding.verdict}] ${finding.rule}: ${finding.message}${placeOf(finding)}`;
}

/** The most findings the text report prints for a layer, passing census findings apart; the JSON report keeps every one (section 6.6). */
const MAX_PRINTED = 100;

/** A passing census finding: one for each hit, which a large project counts by the hundred (WEB_TOPS.md section 6.6). */
const isCensusPass = (finding: Finding): boolean =>
  finding.verdict === "pass" && finding.rule.startsWith(CENSUS_RULE_PREFIX);

/** One line for each census kind, with how many were found, in the order the kinds are first met. */
function censusLines(findings: readonly Finding[]): string[] {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1);
  }
  return [...counts].map(
    ([rule, count]) => `      - [pass] ${rule}: ${String(count)} found, listed in the JSON report`,
  );
}

function findingLines(findings: readonly Finding[]): string[] {
  const rest = findings.filter((finding) => !isCensusPass(finding));
  const shown = rest.slice(0, MAX_PRINTED).map(findingLine);
  const more = rest.length - MAX_PRINTED;
  const folded = censusLines(findings.filter(isCensusPass));
  return more > 0
    ? [...shown, `      - and ${String(more)} more findings, not listed`, ...folded]
    : [...shown, ...folded];
}

function layerLines(layer: ReportLayer): string[] {
  const { name, reason } = split(layer);
  const head = `  ${String(layer.gate).padEnd(7)}${`${name} `.padEnd(15)}tier ${String(layer.tier)}  ${layer.verdict.padEnd(14)}`;
  return [
    reason === undefined ? head.trimEnd() : `${head}${reason}`,
    ...(layer.gate === "laws" ? [] : findingLines(layer.findings)),
  ];
}

/** The laws layer's findings: a stopped run still prints them, for what ran (WEB_TOPS.md section 6.5). */
function lawsFindings(report: Report): readonly Finding[] {
  return report.layers.find((layer) => layer.gate === "laws")?.findings ?? [];
}

function readFrom(report: Report): string {
  const read = report.layers
    .filter((layer) => layer.gate !== "laws" && hasRun(layer.verdict))
    .map((layer) => layer.id);
  return read.length === 0 ? "none" : read.join(", ");
}

function lawsLines(report: Report): string[] {
  const findings = lawsFindings(report);
  return findings.length === 0
    ? []
    : [`  laws mapping (from ${readFrom(report)}):`, ...findingLines(findings), ""];
}

function problemLines(report: Report): string[] {
  return (report.problems ?? []).map((problem) => `problem: ${problem.message} (${problem.path})`);
}

function totalsLine(report: Report): string {
  const { in_range: inRange, ran, failed, not_evaluated: notEvaluated } = report.counts;
  return `layers: ${String(inRange)} in range, ${String(ran)} ran, ${String(failed)} failed, ${String(notEvaluated)} not-evaluated`;
}

function endLines(report: Report): string[] {
  return [
    ...(report.enforced ? [] : [`not enforced (${report.enforce})`]),
    report.passed ? "gate passed" : `gate failed (exit ${String(report.exit_code)})`,
  ];
}

/** The one text rendering of a report: `gate` prints it and `report --format text` reuses it. */
export function formatText(report: Report): string {
  const lines = [
    `webtops gate  ${report.class}  ${report.enforce}  protocol ${report.protocol}`,
    "",
    ...report.layers.flatMap(layerLines),
    "",
    ...lawsLines(report),
    ...problemLines(report),
    totalsLine(report),
    ...endLines(report),
  ];
  return `${lines.join("\n")}\n`;
}
