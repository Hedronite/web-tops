import type { Report, ReportLayer } from "./types.ts";

const REQUIRED_BY = /^(?:(.*) \()?required by ([^)]+?)\)?$/u;

/** The reason with a trailing "required by X" taken out, and the name that goes beside the layer id. */
function split(layer: ReportLayer): { name: string; reason: string | undefined } {
  const match = layer.reason === undefined ? null : REQUIRED_BY.exec(layer.reason);
  if (match?.[2] === undefined) {
    return { name: layer.id, reason: layer.reason };
  }
  const reason = match[1] === undefined || match[1] === "" ? undefined : match[1];
  return { name: `${layer.id} (required by ${match[2]})`, reason };
}

function layerLines(layer: ReportLayer): string[] {
  const { name, reason } = split(layer);
  const head = `  ${String(layer.gate).padEnd(7)}${`${name} `.padEnd(15)}tier ${String(layer.tier)}  ${layer.verdict.padEnd(14)}`;
  const lines = [reason === undefined ? head.trimEnd() : `${head}${reason}`];
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
  for (const problem of report.problems ?? []) {
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
