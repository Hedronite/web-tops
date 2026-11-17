import {
  endsRun,
  LAYER_IDS,
  REPORT_VERSION,
  type BuiltInLayerId,
  type GateReport,
  type LayerReport,
  type Verdict,
} from "./report.ts";
import { PROTOCOL } from "./protocol.ts";
import type { Enforce, Tier } from "./types.ts";

const GATES: Readonly<Record<BuiltInLayerId, LayerReport["gate"]>> = {
  hygiene: 1,
  tests: 2,
  coverage: 3,
  crap: 4,
  mutation: 5,
  "build-output": 6,
  laws: "laws",
};

function needsReason(verdict: Verdict): boolean {
  return verdict === "skip" || verdict === "not-run";
}

export function buildLayer(
  id: string,
  gate: LayerReport["gate"],
  verdict: Verdict = "pass",
): LayerReport {
  const tier: Tier = 1;
  return needsReason(verdict)
    ? {
        id,
        gate,
        tier,
        required: true,
        verdict,
        reason: `${verdict} in the test`,
        findings: [],
        metrics: {},
      }
    : { id, gate, tier, required: true, verdict, findings: [], metrics: {} };
}

function buildLayers(
  verdicts: Partial<Record<BuiltInLayerId, Verdict | undefined>>,
  extra: readonly LayerReport[] = [],
): readonly LayerReport[] {
  return [...LAYER_IDS.map((id) => buildLayer(id, GATES[id], verdicts[id])), ...extra];
}

function countsOf(layers: readonly LayerReport[]): GateReport["counts"] {
  const among = (list: readonly Verdict[]): number =>
    layers.filter((layer) => list.includes(layer.verdict)).length;
  return {
    in_range: layers.length - among(["skip"]),
    ran: layers.length - among(["skip", "not-run"]),
    failed: layers.filter((layer) => endsRun(layer.verdict, layer.required)).length,
    not_evaluated: among(["not-evaluated"]),
    required_not_evaluated: layers.filter(
      (layer) => layer.verdict === "not-evaluated" && layer.required,
    ).length,
  };
}

function isClean(counts: GateReport["counts"]): boolean {
  return counts.in_range > 0 && counts.failed === 0 && counts.ran === counts.in_range;
}

/** A consistent report: counts and `passed` follow from the layers. */
export function buildReport(
  verdicts: Partial<Record<BuiltInLayerId, Verdict | undefined>> = {},
  options: { enforce?: Enforce; extra?: readonly LayerReport[] } = {},
): GateReport {
  const enforce = options.enforce ?? "hard";
  const layers = buildLayers(verdicts, options.extra);
  const counts = countsOf(layers);
  return {
    report_version: REPORT_VERSION,
    protocol: PROTOCOL,
    class: "ts-library",
    enforce,
    enforced: enforce !== "advisory",
    max_tier: 1,
    only: null,
    subject: { package: "fixture", root: "." },
    run: { sha: null, bun: null, node: null, tools: {}, seed: null },
    counts,
    layers,
    passed: isClean(counts),
  };
}
