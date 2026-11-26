import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { applyRatchet } from "../baseline/ratchet.ts";
import type { ClassName } from "../config/profiles.ts";
import { diffScope, type CoverageMap, type ScopeOptions, type ScopeResult } from "../diff/index.ts";
import { COUNTED_LAYERS, completeFindings, countsByRuleFile } from "../report/findings.ts";
import { summarizeLaws } from "../report/laws.ts";
import {
  endsRun,
  hasRun,
  REPORT_VERSION,
  type Counts,
  type Finding,
  type GateRef,
  type LawsSummary,
  type Metrics,
  type Problem,
  type Report,
  type ReportLayer,
  type Verdict,
} from "../report/types.ts";
import { DEFAULT_LEDGER } from "../survivors/check.ts";
import { utcDate } from "../survivors/dates.ts";
import { ledgerState, type LedgerState } from "../survivors/gate.ts";
import { planGate, type PlanItem } from "./plan.ts";
import type {
  Consumed,
  DiffNeeds,
  DiffProvider,
  Exec,
  GateConfig,
  GateOptions,
  Layer,
  LayerContext,
  LayerResult,
  RunDescription,
} from "./types.ts";

export { planGate } from "./plan.ts";

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
  /** Reads the SHA, the runtimes and the tool versions once the layers have run; without it none is known. */
  readonly describe?: () => Promise<RunDescription>;
}

const UNKNOWN: RunDescription = { root: ".", sha: null, bun: null, node: null, tools: {} };

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

/** Whether a layer's verdict ends the run: the failure table of WEB_TOPS.md section 3.3, by whether the layer is required. */
function ends(layer: ReportLayer): boolean {
  return endsRun(layer.verdict, layer.required);
}

function entry(
  item: PlanItem,
  verdict: Verdict,
  reason: string | undefined,
  rest: Partial<
    Pick<ReportLayer, "findings" | "artifacts" | "duration_ms" | "seed" | "metrics">
  > = {},
): ReportLayer {
  return {
    id: item.id,
    gate: item.gate,
    tier: item.tier,
    required: item.required,
    verdict,
    ...reasonOf(reason, item.requiredBy),
    findings: [],
    metrics: {},
    artifacts: [],
    duration_ms: 0,
    ...rest,
  };
}

/** The text of a project file, for a fingerprint's anchor; a path outside the project, or one that cannot be read, has none. */
function readInside(cwd: string, file: string): string | undefined {
  const path = resolve(cwd, file);
  if (relative(cwd, path).startsWith("..")) {
    return undefined;
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Reads each file once for a layer, however many findings point into it. */
export function sourceReader(
  cwd: string,
  read: (cwd: string, file: string) => string | undefined = readInside,
): (file: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (file) => {
    if (!cache.has(file)) {
      cache.set(file, read(cwd, file));
    }
    return cache.get(file);
  };
}

function withoutFindings(metrics: Metrics): Metrics {
  const copy: { -readonly [Key in keyof Metrics]: Metrics[Key] } = { ...metrics };
  delete copy.findings;
  return copy;
}

/** A layer cannot set `metrics.findings`: the counts per rule per file are derived from its findings (section 6.6). */
function metricsOf(id: string, given: Metrics | undefined, findings: readonly Finding[]): Metrics {
  const rest = withoutFindings(given ?? {});
  const rows = COUNTED_LAYERS.has(id) ? countsByRuleFile(findings) : [];
  return rows.length > 0 ? { ...rest, findings: rows } : rest;
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

/** The coverage a layer that does not need the tests' functions gets from the diff engine: none, without a Vitest run. */
const NO_COVERAGE: CoverageMap = new Map();

/** The diff engine's options for a layer: a layer that does not need the tests' functions covers a changed test file with none, and the engine's own run is kept for one that does. */
export const optionsFor = (needs: DiffNeeds, options: ScopeOptions): ScopeOptions =>
  needs.coveredByTests ? options : { ...options, coverageOf: () => Promise.resolve(NO_COVERAGE) };

/** The diff, computed the first time a layer asks and kept for each kind of ask (the test-covered functions cost Vitest runs). */
function diffProvider(input: RunInput, base: string): DiffProvider {
  const asked = new Map<boolean, Promise<ScopeResult>>();
  return (needs: DiffNeeds) => {
    const known = asked.get(needs.coveredByTests);
    if (known !== undefined) {
      return known;
    }
    const exclude = input.config.coverage.exclude.map((entry) => entry.glob);
    const fresh = diffScope(optionsFor(needs, { cwd: input.cwd, base, exec: input.exec, exclude }));
    asked.set(needs.coveredByTests, fresh);
    return fresh;
  };
}

const providers = new WeakMap<RunInput, DiffProvider>();
const runCaches = new WeakMap<RunInput, Map<string, unknown>>();
const cleanups = new WeakMap<RunInput, (() => Promise<void>)[]>();

function cacheOf(input: RunInput): Map<string, unknown> {
  const known = runCaches.get(input);
  if (known !== undefined) return known;
  const fresh = new Map<string, unknown>();
  runCaches.set(input, fresh);
  return fresh;
}

function registerCleanup(input: RunInput, close: () => Promise<void>): void {
  const list = cleanups.get(input) ?? [];
  list.push(close);
  cleanups.set(input, list);
}

async function drainCleanups(input: RunInput): Promise<void> {
  const list = cleanups.get(input);
  if (list === undefined) return;
  cleanups.delete(input);
  for (const close of [...list].reverse()) {
    try {
      await close();
    } catch {
      // Teardown continues across all registered handles.
    }
  }
}

function providerOf(input: RunInput, base: string): DiffProvider {
  const known = providers.get(input);
  if (known !== undefined) {
    return known;
  }
  const fresh = diffProvider(input, base);
  providers.set(input, fresh);
  return fresh;
}

/** The context a layer runs in: the run's settings and the day, from the runner's clock. */
export function contextOf(
  input: RunInput,
  base: string,
  artifacts: ReadonlyMap<string, string>,
  ledger?: LedgerState,
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
    all: input.options.all,
    diff: providerOf(input, base),
    today: utcDate(new Date(input.now())),
    runCache: cacheOf(input),
    onCleanup: (close) => {
      registerCleanup(input, close);
    },
    ...(ledger === undefined ? {} : { explained: ledger.explained }),
    ...(input.options.shard === undefined ? {} : { shard: input.options.shard }),
    ...(input.options.join === undefined ? {} : { joinDir: input.options.join }),
  };
}

const ledgers = new WeakMap<RunInput, LedgerState>();

/** The survivor ledger, read the first time the mutation layer runs and kept for the run (WEB_TOPS.md section 6.4). */
function ledgerOf(input: RunInput): LedgerState {
  const known = ledgers.get(input);
  if (known !== undefined) {
    return known;
  }
  const path = input.config.mutation.ledger ?? DEFAULT_LEDGER;
  const fresh = ledgerState(input.cwd, path, utcDate(new Date(input.now())));
  ledgers.set(input, fresh);
  return fresh;
}

/** The survivor ledger is read once per full run, never during `--shard` (joined later by `--join`). */
export function mutationLedger(layerId: string, input: RunInput): LedgerState | undefined {
  return layerId === "mutation" && input.options.shard === undefined ? ledgerOf(input) : undefined;
}

/** An invalid ledger or an expired entry fails the mutation layer, whatever else it found. */
function withLedger(result: LayerResult, ledger: LedgerState | undefined): LayerResult {
  if (ledger === undefined || ledger.findings.length === 0) {
    return result;
  }
  return { ...result, verdict: "fail", findings: [...result.findings, ...ledger.findings] };
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
    const ledger = mutationLedger(layer.id, input);
    const result = withLedger(
      checked(await layer.run(contextOf(input, base, artifacts, ledger))),
      ledger,
    );
    const kept = keepArtifacts(layer, result.artifacts, input.outDir);
    const findings = completeFindings(result.findings, sourceReader(input.cwd));
    return {
      artifacts: kept,
      layer: entry(item, result.verdict, result.reason, {
        findings,
        metrics: metricsOf(layer.id, result.metrics, findings),
        artifacts: Object.values(kept).map((path) => relative(input.cwd, path)),
        duration_ms: input.now() - started,
        ...(result.seed === undefined ? {} : { seed: result.seed }),
      }),
    };
  } catch (error: unknown) {
    const message = describeError(error);
    return {
      artifacts: {},
      layer: entry(item, "fail", `layer threw: ${message}`, {
        findings: completeFindings(
          [{ tool: "webtops", rule: "layer-threw", verdict: "fail", message }],
          sourceReader(input.cwd),
        ),
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
  const missing = layer.consumes.find(
    (need) => need.optional !== true && producedPath(state, need) === undefined,
  );
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

/**
 * The laws layer reads what the layers before it wrote, so it judges a stopped run too, once every layer it
 * requires has run (R49, WEB_TOPS.md section 6.5). Every other layer stays stopped.
 */
function judgesAfterStop(layer: Layer, state: RunState): boolean {
  return layer.gate === "laws" && layer.requires.every((id) => hasRun(verdictOf(state, id)));
}

function stoppedReason(layer: Layer, state: RunState): string | undefined {
  if (state.stoppedAt === undefined || judgesAfterStop(layer, state)) {
    return undefined;
  }
  return `stopped: gate ${String(state.stoppedAt)} failed`;
}

export function inputProblem(
  layer: Layer,
  state: RunState,
  joinDir: string | undefined,
): string | undefined {
  return joinDir !== undefined && layer.id === "mutation" ? undefined : missingInput(layer, state);
}

/** Whether a layer in range gets to run: it needs a registration, a run that has not stopped, and its inputs. */
function admit(item: PlanItem, state: RunState, joinDir?: string): Admission {
  if (item.layer === undefined) {
    return { reason: "no layer is registered for this id" };
  }
  const reason = stoppedReason(item.layer, state) ?? inputProblem(item.layer, state, joinDir);
  return reason === undefined ? { layer: item.layer } : { reason };
}

function record(state: RunState, item: PlanItem, done: Executed, keepGoing: boolean): void {
  state.layers.push(done.layer);
  if (hasRun(done.layer.verdict)) {
    state.ran += 1;
  }
  state.produced.set(done.layer.id, done.artifacts);
  if (ends(done.layer) && !keepGoing) {
    state.stoppedAt = item.gate;
  }
}

async function step(item: PlanItem, input: RunInput, base: string, state: RunState): Promise<void> {
  if (item.skip !== undefined) {
    state.layers.push(entry(item, "skip", item.skip));
    return;
  }
  state.inRange += 1;
  const admitted = admit(item, state, input.options.join);
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
    failed: state.layers.filter(ends).length,
    not_evaluated: state.layers.filter((layer) => layer.verdict === "not-evaluated").length,
    required_not_evaluated: state.layers.filter(
      (layer) => layer.verdict === "not-evaluated" && layer.required,
    ).length,
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
  return problems.length === 0 && !state.layers.some(ends);
}

function exitCodeOf(passed: boolean, enforced: boolean): 0 | 1 {
  return passed || !enforced ? 0 : 1;
}

/** The seed the tests layer passed, if it ran. */
function seedOf(state: RunState): number | null {
  return state.layers.find((layer) => layer.id === "tests")?.seed ?? null;
}

/** "N of M laws judged", when the laws layer ran: counted from its findings, so a reader can recount it. */
export function lawsOf(
  layers: readonly Report["layers"][number][],
  className: ClassName,
): { laws?: LawsSummary } {
  const layer = layers.find((one) => one.id === "laws");
  return layer !== undefined && hasRun(layer.verdict)
    ? { laws: summarizeLaws(layer.findings, className) }
    : {};
}

function reportOf(
  input: RunInput,
  base: string,
  state: RunState,
  described: RunDescription,
): RanReport {
  const { config, options } = input;
  const problems = problemsOf(state);
  const passed = passedOf(state, problems);
  const enforced = config.enforce !== "advisory";
  return {
    report_version: REPORT_VERSION,
    protocol: config.protocol,
    package: config.package,
    subject: { package: config.package, root: described.root },
    run: {
      sha: described.sha,
      bun: described.bun,
      node: described.node,
      tools: described.tools,
      seed: seedOf(state),
    },
    class: config.class,
    enforce: config.enforce,
    enforced,
    base,
    max_tier: options.maxTier,
    keep_going: options.keepGoing,
    only: options.only ?? null,
    passed,
    crap_scope: config.crap.scope === "all" || options.all ? "all" : "diff",
    exit_code: exitCodeOf(passed, enforced),
    counts: countsOf(state),
    problems,
    layers: state.layers,
    ...lawsOf(state.layers, config.class),
  };
}

/** Under `ratchet`, what the run has above its baseline becomes `refuse` findings on its layers (section 6.7). */
function ratchet(input: RunInput, state: RunState, described: RunDescription): void {
  const { config } = input;
  const layers = applyRatchet({
    enforce: config.enforce,
    baselinePath: config.baselinePath,
    cwd: input.cwd,
    cap: config.crap.cap,
    report: {
      report_version: REPORT_VERSION,
      subject: { package: config.package, root: described.root },
    },
    layers: state.layers,
    read: sourceReader(input.cwd),
  });
  state.layers.splice(0, state.layers.length, ...layers);
}

function describeOf(input: RunInput): Promise<RunDescription> {
  return input.describe === undefined ? Promise.resolve(UNKNOWN) : input.describe();
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
  let described: RunDescription;
  try {
    for (const item of planGate(input.layers, input.config, input.options)) {
      await step(item, input, base, state);
    }
    described = await describeOf(input);
  } finally {
    await drainCleanups(input);
  }
  ratchet(input, state, described);
  return reportOf(input, base, state, described);
}
