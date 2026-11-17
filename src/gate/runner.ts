import {
  isFailing,
  type Counts,
  type GateRef,
  type Problem,
  type Report,
  type ReportLayer,
  type Verdict,
} from "../report/types.ts";
import { relative } from "node:path";
import { compareGates } from "./order.ts";
import type { Exec, GateConfig, GateOptions, Layer, LayerResult, Tier } from "./types.ts";

/** What `runGate` returns: the schema's report, with the exit code the run settled on. */
export type RanReport = Report & { readonly exit_code: 0 | 1 };

interface Executed {
  readonly layer: ReportLayer;
  readonly artifacts: Readonly<Record<string, string>>;
}

export interface RunInput {
  readonly layers: readonly Layer[];
  readonly config: GateConfig;
  readonly options: GateOptions;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exec: Exec;
  readonly outDir: string;
  readonly now: () => number;
}

export interface PlanItem {
  readonly id: string;
  readonly gate: GateRef;
  readonly tier: Tier;
  /** Absent for an id the config enables but nothing registers. */
  readonly layer?: Layer;
  /** Present when the layer will not run, with the reason the report prints. */
  readonly skip?: string;
  /** The `--only` layer that pulled this one in through `requires`. */
  readonly requiredBy?: string;
}

/** The layers `--only` selects: the named ones and, transitively, what they require. */
function selectedBy(
  only: string | undefined,
  layers: readonly Layer[],
): ReadonlyMap<string, string | undefined> {
  const selected = new Map<string, string | undefined>();
  const pending: [string, string | undefined][] = only === undefined ? [] : [[only, undefined]];
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    const [id, requester] = next;
    if (!selected.has(id)) {
      selected.set(id, requester);
      for (const required of layers.find((layer) => layer.id === id)?.requires ?? []) {
        pending.push([required, requester ?? id]);
      }
    }
  }
  return selected;
}

function skipReason(
  id: string,
  tier: Tier,
  classes: readonly string[] | undefined,
  config: GateConfig,
  options: GateOptions,
  selected: ReadonlyMap<string, string | undefined>,
): string | undefined {
  const toggle = config.toggles[id];
  if (toggle?.enabled === false) {
    return toggle.reason ?? "disabled in web-tops.yaml";
  }
  if (classes !== undefined && !classes.includes(config.class)) {
    return `class ${config.class} does not map this layer`;
  }
  if (tier > options.maxTier) {
    return `tier ${String(tier)} is above --max-tier ${String(options.maxTier)}`;
  }
  if (options.only !== undefined && !selected.has(id)) {
    return `not selected by --only ${options.only}`;
  }
  return undefined;
}

/** What a run would do, layer by layer, in gate order. `--dry-run` prints it; `runGate` follows it. */
export function planGate(
  layers: readonly Layer[],
  config: GateConfig,
  options: GateOptions,
): PlanItem[] {
  const selected = selectedBy(options.only, layers);
  const items: PlanItem[] = [...layers]
    .sort((a, b) => compareGates(a.gate, b.gate))
    .map((layer) => {
      const skip = skipReason(layer.id, layer.tier, layer.classes, config, options, selected);
      const requiredBy = selected.get(layer.id);
      return {
        id: layer.id,
        gate: layer.gate,
        tier: layer.tier,
        layer,
        ...(skip === undefined ? {} : { skip }),
        ...(requiredBy === undefined ? {} : { requiredBy }),
      };
    });
  const registered = new Set(layers.map((layer) => layer.id));
  for (const [id, toggle] of Object.entries(config.toggles)) {
    if (toggle.enabled && !registered.has(id) && options.only === undefined) {
      const skip = skipReason(id, 1, undefined, config, options, selected);
      items.push({ id, gate: 6, tier: 1, ...(skip === undefined ? {} : { skip }) });
    }
  }
  return items;
}

/** A layer pulled in by `--only` through `requires` says so in its reason; text and plan show it as "(required by X)". */
function reasonOf(reason: string | undefined, requiredBy: string | undefined): { reason?: string } {
  if (requiredBy === undefined) {
    return reason === undefined ? {} : { reason };
  }
  return {
    reason:
      reason === undefined ? `required by ${requiredBy}` : `${reason} (required by ${requiredBy})`,
  };
}

/** Verdicts of a layer that judged: only these count as `ran` (WEB_TOPS.md section 3.3). */
const EVALUATED: ReadonlySet<Verdict> = new Set<Verdict>([
  "pass",
  "Refuse",
  "Ack",
  "not-evaluated",
]);

function entry(
  item: PlanItem,
  verdict: Verdict,
  reason: string | undefined,
  rest: Partial<Pick<ReportLayer, "findings" | "artifacts" | "duration_ms">> = {},
): ReportLayer {
  return {
    id: item.id,
    gate: item.gate,
    tier: item.tier,
    verdict,
    ...reasonOf(reason, item.requiredBy),
    findings: rest.findings ?? [],
    artifacts: rest.artifacts ?? [],
    duration_ms: rest.duration_ms ?? 0,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A layer must say why it skipped; a bare `skip` would hide a missing reader. */
function checked(result: LayerResult): LayerResult {
  if (result.verdict === "skip" && (result.reason === undefined || result.reason === "")) {
    return { ...result, verdict: "not-evaluated", reason: "layer returned skip without a reason" };
  }
  return result;
}

async function execute(
  item: PlanItem,
  layer: Layer,
  input: RunInput,
  base: string,
  artifacts: ReadonlyMap<string, string>,
): Promise<Executed> {
  const started = input.now();
  let result: LayerResult;
  try {
    result = checked(
      await layer.run({
        cwd: input.cwd,
        config: input.config,
        base,
        enforce: input.config.enforce,
        env: input.env,
        exec: input.exec,
        outDir: input.outDir,
        artifacts,
      }),
    );
  } catch (error: unknown) {
    const message = describeError(error);
    return {
      artifacts: {},
      layer: entry(item, "not-evaluated", `layer threw: ${message}`, {
        findings: [{ rule: "layer-threw", verdict: "not-evaluated", message }],
        duration_ms: input.now() - started,
      }),
    };
  }
  return {
    artifacts: result.artifacts,
    layer: entry(item, result.verdict, result.reason, {
      findings: result.findings,
      artifacts: Object.values(result.artifacts).map((path) => relative(input.cwd, path)),
      duration_ms: input.now() - started,
    }),
  };
}

/** Runs the plan and builds the report (WEB_TOPS.md sections 3.1, 3.3, 6.6, 12). */
export async function runGate(input: RunInput): Promise<RanReport> {
  const { config, options } = input;
  // `--base` is handed to layers as a string and not checked here. The first layer that reads it is
  // mutation (M2), which resolves the merge base and fails a ref that does not resolve (section 6.4).
  const base = options.base ?? config.base ?? "origin/main";
  const artifacts = new Map<string, string>();
  const layers: ReportLayer[] = [];
  let inRange = 0;
  let ran = 0;
  let stoppedAt: GateRef | undefined;
  for (const item of planGate(input.layers, config, options)) {
    if (item.skip !== undefined) {
      layers.push(entry(item, "skip", item.skip));
      continue;
    }
    inRange += 1;
    if (item.layer === undefined) {
      layers.push(entry(item, "not-run", "no layer is registered for this id"));
    } else if (stoppedAt !== undefined) {
      layers.push(entry(item, "not-run", `stopped: gate ${String(stoppedAt)} failed`));
    } else {
      const result = await execute(item, item.layer, input, base, artifacts);
      if (EVALUATED.has(result.layer.verdict)) {
        ran += 1;
      } else if (result.layer.verdict === "skip") {
        // A layer that says it does not apply (with a reason) leaves the range, as a configured skip does.
        inRange -= 1;
      }
      layers.push(result.layer);
      for (const [name, path] of Object.entries(result.artifacts)) {
        artifacts.set(name, path);
      }
      if (isFailing(result.layer.verdict) && !options.keepGoing) {
        stoppedAt = item.gate;
      }
    }
  }
  const counts: Counts = {
    in_range: inRange,
    ran,
    failed: layers.filter(
      (layer) =>
        layer.verdict === "Refuse" || layer.verdict === "Ack" || layer.verdict === "not-run",
    ).length,
    not_evaluated: layers.filter((layer) => layer.verdict === "not-evaluated").length,
  };
  const problems: Problem[] = [];
  if (inRange === 0) {
    problems.push({ path: "/counts/in_range", message: "no layer ran" });
  } else if (ran < inRange && stoppedAt === undefined) {
    problems.push({
      path: "/counts/ran",
      message: `ran ${String(ran)} of ${String(inRange)} layers in range`,
    });
  }
  const passed =
    problems.length === 0 && ran === inRange && !layers.some((layer) => isFailing(layer.verdict));
  const enforced = config.enforce !== "advisory";
  return {
    protocol: config.protocol,
    package: config.package,
    class: config.class,
    enforce: config.enforce,
    enforced,
    base,
    max_tier: options.maxTier,
    keep_going: options.keepGoing,
    only: options.only ?? null,
    passed,
    exit_code: passed || !enforced ? 0 : 1,
    counts,
    problems,
    layers,
  };
}
