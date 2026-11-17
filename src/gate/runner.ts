import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  isFailing,
  type Counts,
  type GateRef,
  type Problem,
  type Report,
  type ReportLayer,
  type Verdict,
} from "../report/types.ts";
import { planGate, type PlanItem } from "./plan.ts";
import type {
  Consumed,
  Exec,
  GateConfig,
  GateOptions,
  Layer,
  LayerContext,
  LayerResult,
} from "./types.ts";

export { planGate, type PlanItem } from "./plan.ts";

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

/** What the run knows so far: the entries in order, the artifacts that exist, and where it stopped. */
interface RunState {
  readonly layers: ReportLayer[];
  /** What each layer that ran left on disk, by the layer's id and then the artifact's name. */
  readonly produced: Map<string, Readonly<Record<string, string>>>;
  inRange: number;
  ran: number;
  stoppedAt: GateRef | undefined;
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

/** Verdicts that count in `failed`; `not-evaluated` is counted apart (section 6.6). */
const FAILED: ReadonlySet<Verdict> = new Set<Verdict>(["Refuse", "Ack", "not-run"]);

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
    findings: [],
    artifacts: [],
    duration_ms: 0,
    ...rest,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The range is fixed before the run, from the config and the class (WEB_TOPS.md section 3.3). A layer that is
 * in range cannot leave it by returning `skip`: that result is `not-evaluated` and fails. A layer reports
 * the steps it skips as `skip` findings with its own verdict `pass`.
 */
function checked(result: LayerResult): LayerResult {
  if (result.verdict === "skip") {
    return { ...result, verdict: "not-evaluated", reason: "skip returned by an in-range layer" };
  }
  return result;
}

/** One artifact survives when the layer declared it, wrote it under its own `.web-tops/out/<layer>/`, and the file exists. */
function keeps(layer: Layer, home: string, name: string, path: string): boolean {
  return layer.produces.includes(name) && path.startsWith(home) && existsSync(path);
}

function keepArtifacts(
  layer: Layer,
  found: Readonly<Record<string, string>>,
  outDir: string,
): Record<string, string> {
  const home = `${join(outDir, layer.id)}${sep}`;
  return Object.fromEntries(
    Object.entries(found).filter(([name, path]) => keeps(layer, home, name, path)),
  );
}

function contextOf(
  input: RunInput,
  base: string,
  artifacts: ReadonlyMap<string, string>,
): LayerContext {
  return {
    cwd: input.cwd,
    config: input.config,
    base,
    enforce: input.config.enforce,
    env: input.env,
    exec: input.exec,
    outDir: input.outDir,
    artifacts,
  };
}

async function execute(
  item: PlanItem,
  layer: Layer,
  input: RunInput,
  base: string,
  artifacts: ReadonlyMap<string, string>,
): Promise<Executed> {
  const started = input.now();
  try {
    const result = checked(await layer.run(contextOf(input, base, artifacts)));
    const kept = keepArtifacts(layer, result.artifacts, input.outDir);
    return {
      artifacts: kept,
      layer: entry(item, result.verdict, result.reason, {
        findings: result.findings,
        artifacts: Object.values(kept).map((path) => relative(input.cwd, path)),
        duration_ms: input.now() - started,
      }),
    };
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
}

/** What happened to a layer a consumer needs: its verdict in this run, `not-run` when it has no entry. */
function verdictOf(state: RunState, id: string): Verdict {
  return state.layers.find((layer) => layer.id === id)?.verdict ?? "not-run";
}

function producedPath(state: RunState, need: Consumed): string | undefined {
  return state.produced.get(need.from)?.[need.artifact];
}

/** R29 N5: the first input this layer consumes that its named producer did not leave on disk, worded for the report. */
function missingInput(layer: Layer, state: RunState): string | undefined {
  const missing = layer.consumes.find((need) => producedPath(state, need) === undefined);
  return missing === undefined
    ? undefined
    : `input ${missing.artifact} missing: ${missing.from} ${verdictOf(state, missing.from)}`;
}

/** What a layer is shown: each input it declared, by name, taken from the layer it named and no other (R37). */
function inputsOf(layer: Layer, state: RunState): ReadonlyMap<string, string> {
  return new Map(
    layer.consumes.flatMap((need): [string, string][] => {
      const path = producedPath(state, need);
      return path === undefined ? [] : [[need.artifact, path]];
    }),
  );
}

type Admission = { readonly reason: string } | { readonly layer: Layer };

/** Whether a layer in range gets to run: it needs a registration, a run that has not stopped, and its inputs. */
function admit(item: PlanItem, state: RunState): Admission {
  if (item.layer === undefined) {
    return { reason: "no layer is registered for this id" };
  }
  if (state.stoppedAt !== undefined) {
    return { reason: `stopped: gate ${String(state.stoppedAt)} failed` };
  }
  const missing = missingInput(item.layer, state);
  return missing === undefined ? { layer: item.layer } : { reason: missing };
}

function record(state: RunState, item: PlanItem, done: Executed, keepGoing: boolean): void {
  state.layers.push(done.layer);
  if (EVALUATED.has(done.layer.verdict)) {
    state.ran += 1;
  }
  state.produced.set(done.layer.id, done.artifacts);
  if (isFailing(done.layer.verdict) && !keepGoing) {
    state.stoppedAt = item.gate;
  }
}

async function step(item: PlanItem, input: RunInput, base: string, state: RunState): Promise<void> {
  if (item.skip !== undefined) {
    state.layers.push(entry(item, "skip", item.skip));
    return;
  }
  state.inRange += 1;
  const admitted = admit(item, state);
  if ("reason" in admitted) {
    state.layers.push(entry(item, "not-run", admitted.reason));
    return;
  }
  const done = await execute(item, admitted.layer, input, base, inputsOf(admitted.layer, state));
  record(state, item, done, input.options.keepGoing);
}

function countsOf(state: RunState): Counts {
  return {
    in_range: state.inRange,
    ran: state.ran,
    failed: state.layers.filter((layer) => FAILED.has(layer.verdict)).length,
    not_evaluated: state.layers.filter((layer) => layer.verdict === "not-evaluated").length,
  };
}

function problemsOf(state: RunState): Problem[] {
  if (state.inRange === 0) {
    return [{ path: "/counts/in_range", message: "no layer ran" }];
  }
  if (state.ran < state.inRange && state.stoppedAt === undefined) {
    return [
      {
        path: "/counts/ran",
        message: `ran ${String(state.ran)} of ${String(state.inRange)} layers in range`,
      },
    ];
  }
  return [];
}

function passedOf(state: RunState, problems: readonly Problem[]): boolean {
  const clean = problems.length === 0 && state.ran === state.inRange;
  return clean && !state.layers.some((layer) => isFailing(layer.verdict));
}

function exitCodeOf(passed: boolean, enforced: boolean): 0 | 1 {
  return passed || !enforced ? 0 : 1;
}

function reportOf(input: RunInput, base: string, state: RunState): RanReport {
  const { config, options } = input;
  const problems = problemsOf(state);
  const passed = passedOf(state, problems);
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
    exit_code: exitCodeOf(passed, enforced),
    counts: countsOf(state),
    problems,
    layers: state.layers,
  };
}

/** Runs the plan and builds the report (WEB_TOPS.md sections 3.1, 3.3, 6.6, 12). */
export async function runGate(input: RunInput): Promise<RanReport> {
  // `--base` is handed to layers as a string and not checked here. The first layer that reads it is
  // mutation (M2), which resolves the merge base and fails a ref that does not resolve (section 6.4).
  const base = input.options.base ?? input.config.base ?? "origin/main";
  const state: RunState = {
    layers: [],
    produced: new Map<string, Readonly<Record<string, string>>>(),
    inRange: 0,
    ran: 0,
    stoppedAt: undefined,
  };
  for (const item of planGate(input.layers, input.config, input.options)) {
    await step(item, input, base, state);
  }
  return reportOf(input, base, state);
}
