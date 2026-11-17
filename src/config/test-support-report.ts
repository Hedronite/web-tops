import { LAYER_IDS, type BuiltInLayerId, type GateReport, type LayerReport, type Verdict } from "./report.ts";
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

export function buildLayer(id: string, gate: LayerReport["gate"], verdict: Verdict = "pass"): LayerReport {
  const tier: Tier = gate === "laws" ? 0 : 1;
  return verdict === "skip" || verdict === "not-run"
    ? { id, gate, tier, verdict, reason: `${verdict} in the test`, findings: [] }
    : { id, gate, tier, verdict, findings: [] };
}

/** A consistent report: counts and `passed` follow from the layers. */
export function buildReport(
  verdicts: Partial<Record<BuiltInLayerId, Verdict | undefined>> = {},
  options: { enforce?: Enforce; extra?: readonly LayerReport[] } = {},
): GateReport {
  const enforce = options.enforce ?? "hard";
  const layers = [
    ...LAYER_IDS.map((id) => buildLayer(id, GATES[id], verdicts[id])),
    ...(options.extra ?? []),
  ];
  const among = (list: readonly Verdict[]): number =>
    layers.filter((layer) => list.includes(layer.verdict)).length;
  const counts = {
    in_range: layers.length - among(["skip"]),
    ran: layers.length - among(["skip", "not-run"]),
    failed: among(["Refuse", "Ack", "not-run"]),
    not_evaluated: among(["not-evaluated"]),
  };
  return {
    protocol: PROTOCOL,
    class: "ts-library",
    enforce,
    enforced: enforce !== "advisory",
    max_tier: 1,
    only: null,
    counts,
    layers,
    passed:
      counts.in_range > 0 &&
      counts.failed === 0 &&
      counts.not_evaluated === 0 &&
      counts.ran === counts.in_range,
  };
}
