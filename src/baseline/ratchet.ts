import {
  COUNTED_LAYERS,
  countsByRuleFile,
  endsRun,
  type Finding,
  type GateReport,
  type LayerReport,
} from "../config/report.ts";
import { completeFindings, type RawFinding } from "../report/findings.ts";
import { ratchetBreaches } from "./compare.ts";
import { projectBaseline } from "./project.ts";
import { readBaseline, type ReadResult } from "./read.ts";
import type { Breach } from "./types.ts";

type Reader = (file: string) => string | undefined;

const refusal = (breach: Breach): RawFinding => ({
  tool: "webtops",
  rule: breach.rule,
  verdict: "refuse",
  message: breach.message,
  ...(breach.file === undefined ? {} : { file: breach.file }),
});

/** A layer's metrics once findings were added: the layers that count findings per rule per file recount them. */
function metricsAfter(layer: LayerReport, findings: readonly Finding[]): LayerReport["metrics"] {
  if (!COUNTED_LAYERS.has(layer.id)) return layer.metrics;
  const rows = countsByRuleFile(findings);
  const rest = Object.fromEntries(
    Object.entries(layer.metrics).filter(([key]) => key !== "findings"),
  );
  return rows.length > 0 ? { ...rest, findings: rows } : rest;
}

/** The layer with findings added; a layer that does not already end the run now ends it with `verdict`. */
function withFindings(
  layer: LayerReport,
  raws: readonly RawFinding[],
  verdict: "refuse" | "fail",
  read: Reader,
): LayerReport {
  const findings = [...layer.findings, ...completeFindings(raws, read)];
  const ends = endsRun(layer.verdict, layer.required);
  return {
    ...layer,
    verdict: ends ? layer.verdict : verdict,
    findings,
    metrics: metricsAfter(layer, findings),
  };
}

export interface RatchetInput {
  readonly enforce: string;
  /** The baseline's path under `cwd`; none means the config names no baseline to read. */
  readonly baselinePath: string | undefined;
  readonly cwd: string;
  /** The CRAP cap a new function is held to. */
  readonly cap: number;
  readonly report: Pick<GateReport, "report_version" | "subject">;
  readonly layers: readonly LayerReport[];
  readonly read: Reader;
}

/** The baseline cannot be read: the run fails on the hygiene layer, which `check` would have refused first. */
function unreadable(input: RatchetInput, reason: string): LayerReport[] {
  const raw: RawFinding = {
    tool: "webtops",
    rule: "baseline-unreadable",
    verdict: "fail",
    message: reason,
  };
  return input.layers.map((layer) =>
    layer.id === "hygiene" ? withFindings(layer, [raw], "fail", input.read) : layer,
  );
}

/** The layer with its own breaches added, if it has any. */
function judged(layer: LayerReport, breaches: readonly Breach[], read: Reader): LayerReport {
  const mine = breaches.filter((breach) => breach.layer === layer.id).map(refusal);
  return mine.length === 0 ? layer : withFindings(layer, mine, "refuse", read);
}

/** No baseline yet is the bootstrap state, in which nothing is held; one that cannot be read fails the run. */
function unavailable(input: RatchetInput, base: Extract<ReadResult, { ok: false }>): LayerReport[] {
  return base.missing === true ? [...input.layers] : unreadable(input, base.reason);
}

/**
 * Under `ratchet`, what the run has above its baseline becomes `refuse` findings on the layers they belong to
 * (WEB_TOPS.md section 6.7), and those layers end the run. Other modes read no baseline.
 */
export function applyRatchet(input: RatchetInput): LayerReport[] {
  if (input.enforce !== "ratchet" || input.baselinePath === undefined) return [...input.layers];
  const base = readBaseline(input.cwd, input.baselinePath);
  if (!base.ok) return unavailable(input, base);
  const current = projectBaseline({ ...input.report, layers: input.layers });
  const breaches = ratchetBreaches(base.baseline, current, input.cap);
  return input.layers.map((layer) => judged(layer, breaches, input.read));
}
