import { isCountable } from "./state.ts";
import { endsRun, type Finding, type GateReport, type LayerReport } from "../config/report.ts";

type Holds = (finding: Finding) => boolean;

/** A finding the baseline counts per rule per file: a tool's, with a place in a file. */
const counted: Holds = isCountable;

/** What a baseline holds, by layer (WEB_TOPS.md section 6.7); anything else a layer fails on is not something to adopt. */
const HOLDS: Readonly<Record<string, Holds>> = {
  hygiene: counted,
  laws: counted,
  coverage: (finding) => finding.rule === "coverage-below-floor",
  crap: (finding) => finding.rule === "crap-over-cap",
  mutation: (finding) => finding.rule === "survived" || finding.rule === "no-coverage",
};

function endingFindings(layer: LayerReport): readonly Finding[] {
  return layer.findings.filter((finding) => endsRun(finding.verdict, finding.required ?? true));
}

const FAILS = new Set(["fail", "refuse"]);

/** A layer's verdict, with the rule it failed on when it says one. */
function shown(layer: LayerReport): string {
  const rule = endingFindings(layer)[0]?.rule;
  return rule === undefined
    ? `${layer.id} is ${layer.verdict}`
    : `${layer.id} is ${layer.verdict} (${rule})`;
}

function findingsProblem(layer: LayerReport, holds: Holds): string | undefined {
  const ending = endingFindings(layer);
  if (ending.length === 0) return `${layer.id} is ${layer.verdict} with nothing a baseline holds`;
  const other = ending.find((finding) => !holds(finding));
  return other === undefined
    ? undefined
    : `${layer.id} has ${other.rule}, which a baseline does not hold`;
}

/** Why one layer's failure is not a first baseline's to hold, or undefined when it is, or when it did not fail. */
function layerProblem(layer: LayerReport): string | undefined {
  if (!endsRun(layer.verdict, layer.required)) return undefined;
  const holds = HOLDS[layer.id];
  if (holds === undefined || !FAILS.has(layer.verdict)) return shown(layer);
  return findingsProblem(layer, holds);
}

/**
 * With no baseline yet, a report that did not pass may still be the first one, when its only failures are items a
 * baseline holds: a CRAP over the cap, coverage under the floor, counted findings, unexplained survivors. A crashed
 * or unrun layer, failing or missing tests, a tool that could not run, or a run that did not finish are refused
 * (WEB_TOPS.md section 6.7). Returns why not, or undefined.
 */
export function bootstrapProblem(report: GateReport): string | undefined {
  const incomplete = report.problems?.[0];
  if (incomplete !== undefined) return `the run is incomplete: ${incomplete.message}`;
  return report.layers.map(layerProblem).find((problem) => problem !== undefined);
}

const RAN = new Set(["pass", "fail", "refuse", "vacuous", "not-evaluated", "ack-missing"]);

/** The baseline holds every function, so its CRAP must come from a run that judged them all (WEB_TOPS.md section 6.6). */
export function scopeProblem(report: GateReport): string | undefined {
  const crap = report.layers.find((layer) => layer.id === "crap");
  if (crap === undefined || !RAN.has(crap.verdict) || report.crap_scope === "all") return undefined;
  return "the last run judged only the functions the diff changed, and the baseline holds every function; run webtops gate --all --keep-going, then webtops baseline again";
}
