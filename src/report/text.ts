import type { Report, ReportLayer } from "./types.ts";

function layerLines(layer: ReportLayer): string[] {
  const head = `  ${String(layer.gate).padEnd(7)}${layer.id.padEnd(14)}tier ${String(layer.tier)}  ${layer.verdict.padEnd(14)}`;
  const lines = [layer.reason === undefined ? head.trimEnd() : `${head}${layer.reason}`];
  for (const finding of layer.findings) {
    const file = finding.file === undefined ? "" : finding.file;
    const where = finding.line === undefined ? file : `${file}:${String(finding.line)}`;
    const place = where === "" ? "" : ` (${where})`;
    lines.push(`      - [${finding.verdict}] ${finding.rule}: ${finding.message}${place}`);
  }
  return lines;
}

/** The one text rendering of a report: `gate` prints it and `report --format text` reuses it. */
export function formatText(report: Report): string {
  const lines = [
    `webtops gate  ${report.class}  ${report.enforce}  protocol ${report.protocol}`,
    "",
  ];
  for (const layer of report.layers) {
    lines.push(...layerLines(layer));
  }
  lines.push("");
  for (const problem of report.problems) {
    lines.push(`problem: ${problem.message} (${problem.path})`);
  }
  const { in_range: inRange, ran, failed, not_evaluated: notEvaluated } = report.counts;
  lines.push(
    `layers: ${String(inRange)} in range, ${String(ran)} ran, ${String(failed)} failed, ${String(notEvaluated)} not-evaluated`,
  );
  if (!report.enforced) {
    lines.push(`not enforced (${report.enforce})`);
  }
  lines.push(report.passed ? "gate passed" : `gate failed (exit ${String(report.exit_code)})`);
  return `${lines.join("\n")}\n`;
}
