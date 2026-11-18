import {
  COUNTED_LAYERS,
  endsRun,
  type Finding,
  type GateReport,
  type LayerReport,
} from "../config/report.ts";
import { censusKindOf } from "./census.ts";
import type { Baseline, BaselineCoverage, BaselineCrap, CensusEntry } from "./types.ts";

function metricsOf(report: GateReport, id: string): LayerReport["metrics"] {
  return report.layers.find((layer) => layer.id === id)?.metrics ?? {};
}

function crapOf(report: GateReport): Record<string, BaselineCrap> {
  const rows = metricsOf(report, "crap").crap ?? [];
  return Object.fromEntries(
    rows.map((row) => [
      `${row.file}::${row.name}`,
      { complexity: row.complexity, coverage: row.coverage, crap: row.crap },
    ]),
  );
}

function coverageOf(report: GateReport): Record<string, BaselineCoverage> {
  const rows = metricsOf(report, "coverage").coverage ?? [];
  if (rows.length === 0) return {};
  const sum = (key: "lines_found" | "lines_hit"): number =>
    rows.reduce((total, row) => total + row[key], 0);
  return {
    [report.subject.package]: { lines_found: sum("lines_found"), lines_hit: sum("lines_hit") },
  };
}

function countedLayers(report: GateReport): readonly LayerReport[] {
  return report.layers.filter((layer) => COUNTED_LAYERS.has(layer.id));
}

type Counts = Record<string, Record<string, number>>;

/** The findings the baseline counts: those of the counted layers that have a place and whose verdict ends the run (R69). */
function countedFindings(report: GateReport): readonly Finding[] {
  return countedLayers(report)
    .flatMap((layer) => layer.findings)
    .filter(
      (finding) => finding.file !== null && endsRun(finding.verdict, finding.required ?? true),
    );
}

function addFinding(out: Counts, finding: Finding): Counts {
  const files = out[finding.rule] ?? {};
  const file = finding.file ?? "";
  return { ...out, [finding.rule]: { ...files, [file]: (files[file] ?? 0) + 1 } };
}

function findingsOf(report: GateReport): Counts {
  return countedFindings(report).reduce<Counts>(addFinding, {});
}

function fingerprintsOf(report: GateReport): readonly string[] {
  return [...new Set(countedFindings(report).map((finding) => finding.fingerprint))].sort();
}

function censusOf(report: GateReport): Record<string, CensusEntry> {
  const byKind = new Map<string, string[]>();
  const hints = report.layers.flatMap((layer) => layer.findings);
  for (const finding of hints) {
    const kind = censusKindOf(finding);
    if (kind !== undefined) byKind.set(kind, [...(byKind.get(kind) ?? []), finding.fingerprint]);
  }
  return Object.fromEntries(
    [...byKind.entries()].map(([kind, prints]) => [
      kind,
      { count: prints.length, fingerprints: [...prints].sort() },
    ]),
  );
}

function pagesOf(report: GateReport): Record<string, number> {
  const rows = metricsOf(report, "build-output").pages ?? [];
  return Object.fromEntries(rows.map((row) => [row.route, row.bytes]));
}

/**
 * The baseline of a run (WEB_TOPS.md section 6.6): CRAP per function, coverage per package, finding counts per
 * rule per file with the fingerprints of those findings, suppression counts by census kind, and bytes per page,
 * with the report's version and subject. Every value comes from the report; nothing else is read.
 */
export function projectBaseline(report: GateReport): Baseline {
  return {
    report_version: report.report_version,
    subject: report.subject,
    crap: crapOf(report),
    coverage: coverageOf(report),
    findings: findingsOf(report),
    fingerprints: fingerprintsOf(report),
    census: censusOf(report),
    pages: pagesOf(report),
  };
}
