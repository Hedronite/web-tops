import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTypeScript } from "../../complexity/index.ts";
import type { Ts } from "../../complexity/index.ts";
import type {
  DiffProvider,
  Layer,
  LayerContext,
  LayerResult,
  ShardSpec,
} from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import type { MutationMetric } from "../../config/report.ts";
import { keyString } from "../../survivors/key.ts";
import type { SurvivorKey } from "../../survivors/key.ts";
import { excludesOf, inScope } from "../coverage/scope.ts";
import { trackedFiles } from "../coverage/tracked.ts";
import { failFinding, parseJson, readOutput, relativeTo, runTool } from "../hygiene/tooling.ts";
import { strykerConfig } from "./config.ts";
import { usableWorkers } from "./cpus.ts";
import { strykerTrouble, VACUOUS } from "./failed.ts";
import { loadJoined, type JoinedMutation } from "./join.ts";
import {
  readPartial,
  timedOutPartial,
  vacuousPartial,
  writePartial,
  type ShardMeta,
} from "./partial.ts";
import { readMutation } from "./read.ts";
import type { MutationRead, SurvivorRow } from "./read.ts";
import { hashEntries, shardOf } from "./shard.ts";
import { snapEntries } from "./snap.ts";

/** Gate 5: StrykerJS over the diff's functions, or over every source file, judged by the survivors left (section 6.4). */

const MINUTE = 60 * 1000;
const NONE: ReadonlySet<string> = new Set();

function failed(finding: RawFinding): LayerResult {
  return { verdict: "fail", findings: [finding], artifacts: {} };
}

function typescriptOf(cwd: string): { readonly ts: Ts } | { readonly finding: RawFinding } {
  try {
    return { ts: loadTypeScript(cwd) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "typescript could not be loaded";
    return { finding: failFinding("webtops", "typescript-missing", message) };
  }
}

type FoundEntries = {
  readonly entries: readonly string[];
  readonly base: string;
  readonly vacuousReason?: string;
};

type Entries = FoundEntries | { readonly stop: LayerResult };

/** `--all`, or the config's scope all, or no diff to ask: every source file in scope. */
function diffOf(ctx: LayerContext): DiffProvider | undefined {
  return ctx.all === true || ctx.config.mutation.scope === "all" ? undefined : ctx.diff;
}

async function allFiles(ctx: LayerContext): Promise<Entries> {
  const tracked = await trackedFiles(ctx);
  if ("finding" in tracked) {
    return { stop: failed(tracked.finding) };
  }
  const excludes = excludesOf(ctx.config);
  return { entries: tracked.files.filter((file) => inScope(file, excludes)), base: ctx.base };
}

/** A vacuous diff still emits `partial.json` when `--shard` is set, preserving `mergeBase` and `entriesHash`. */
export function vacuousDiff(
  shard: ShardSpec | undefined,
  reason: string,
  mergeBase: string,
): Entries {
  return shard === undefined
    ? { stop: { verdict: "vacuous", reason, findings: [], artifacts: {} } }
    : { entries: [], base: mergeBase, vacuousReason: reason };
}

/** The file of a `mutate` entry, `<file>:<start>-<end>`. */
const entryFile = (entry: string): string => entry.replace(/:[^:]*$/u, "");

/**
 * The diff's ranges, with the functions the changed tests run, widened to whole scored units (R64). Like the whole
 * project, the diff is held to the coverage scope (section 6.1): a changed `*.config.*` or an excluded file is not
 * mutated, and a diff with nothing left in scope is `vacuous`.
 */
export async function fromDiff(
  ctx: LayerContext,
  diff: DiffProvider,
  snap: (entries: readonly string[]) => readonly string[],
): Promise<Entries> {
  const found = await diff({ coveredByTests: true });
  if (found.outcome === "fail") {
    return { stop: failed(failFinding("webtops", "diff-failed", found.reason)) };
  }
  if (found.outcome === "vacuous") {
    return vacuousDiff(ctx.shard, found.reason, found.scope.mergeBase);
  }
  const excludes = excludesOf(ctx.config);
  const mutate = found.scope.mutate.filter((entry) => inScope(entryFile(entry), excludes));
  if (mutate.length === 0) {
    return vacuousDiff(
      ctx.shard,
      "the diff changes no file in coverage scope",
      found.scope.mergeBase,
    );
  }
  return { entries: snap(mutate), base: found.scope.mergeBase };
}

async function entriesOf(ctx: LayerContext, ts: Ts): Promise<Entries> {
  const diff = diffOf(ctx);
  return diff === undefined
    ? allFiles(ctx)
    : fromDiff(ctx, diff, (entries) =>
        snapEntries(ts, entries, (file) => readOutput(join(ctx.cwd, file))),
      );
}

/** Writes the run's Stryker config under `.web-tops/out/mutation/` and returns its path and the report's. */
function writeConfig(
  ctx: LayerContext,
  wrapper: string,
  entries: readonly string[],
): { readonly config: string; readonly report: string } {
  const directory = join(ctx.outDir, "mutation");
  mkdirSync(directory, { recursive: true });
  const config = join(directory, "stryker.config.json");
  const report = join(directory, "mutation.json");
  const tsconfig = existsSync(join(ctx.cwd, "tsconfig.json")) ? { tsconfig: "tsconfig.json" } : {};
  const plan = {
    mutate: entries,
    vitestConfig: relativeTo(ctx.cwd, wrapper),
    report: relativeTo(ctx.cwd, report),
    tempDir: relativeTo(ctx.cwd, join(directory, ".stryker-tmp")),
    concurrency: usableWorkers(),
    ...tsconfig,
  };
  writeFileSync(config, JSON.stringify(strykerConfig(plan), null, 2));
  return { config: relativeTo(ctx.cwd, config), report };
}

export function overBudget(ctx: LayerContext, meta?: ShardMeta): LayerResult {
  if (meta !== undefined) {
    writePartial(ctx.outDir, timedOutPartial(meta));
  }
  const minutes = String(ctx.config.mutation.timeBudgetMinutes);
  return {
    verdict: "not-evaluated",
    reason: `stryker was stopped at the time budget of ${minutes} minutes; a run cut short is never a pass`,
    findings: [],
    artifacts: {},
  };
}

function tooLong(text: string): string {
  const nl = text.indexOf("\n");
  const line = nl === -1 ? text : text.slice(0, nl);
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

function changeOf(key: SurvivorKey): string {
  return `${key.mutator} \`${tooLong(key.original)}\` -> \`${tooLong(key.replacement)}\``;
}

/** A survivor the ledger accepts: a pass, listed so the report shows what was accepted and `webtops survivors list` can see it. */
function acceptedFinding(row: SurvivorRow): RawFinding {
  const { key } = row;
  return {
    tool: "stryker",
    rule: "explained",
    verdict: "pass",
    message: `${changeOf(key)} is accepted in the survivor ledger (${key.function})`,
    file: row.file,
    line: row.line,
    survivor: key,
  };
}

function survivorFinding(row: SurvivorRow, over: boolean): RawFinding {
  const { key } = row;
  const change = changeOf(key);
  const rule = row.status === "NoCoverage" ? "no-coverage" : "survived";
  const said = rule === "no-coverage" ? "is not covered by any test" : "survived: no test failed";
  return {
    tool: "stryker",
    rule,
    verdict: over ? "fail" : "pass",
    message: `${change} ${said} (${key.function})`,
    file: row.file,
    line: row.line,
    survivor: key,
  };
}

function unknownFinding(status: string): RawFinding {
  const shown = status === "" ? "no status" : status;
  return failFinding(
    "stryker",
    "unknown-status",
    `a mutant has the status ${shown}, which the status table does not list; it is counted nowhere`,
  );
}

/** Every status Stryker gave a mutant, with its count, so a run that read differently on another machine shows how. */
function countsOf(counts: MutationMetric): string {
  return [
    `killed ${String(counts.killed)}`,
    `timeout ${String(counts.timeout)}`,
    `survived ${String(counts.survived)}`,
    `no-coverage ${String(counts.no_coverage)}`,
    `runtime-error ${String(counts.runtime_error)}`,
    `compile-error ${String(counts.compile_error)}`,
    `ignored ${String(counts.ignored)}`,
  ].join(", ");
}

function summary(ctx: LayerContext, read: MutationRead, open: readonly SurvivorRow[]): RawFinding {
  const { maxSurvivors } = ctx.config.mutation;
  const explained = read.survivors.length - open.length;
  return {
    tool: "webtops",
    rule: "mutation",
    verdict: "pass",
    message:
      `${ctx.config.package}: ${String(read.killed)} mutants killed, ${String(open.length)} unexplained ` +
      `survivors of ${String(read.survivors.length)} (${String(explained)} explained), ` +
      `${String(read.excluded)} excluded, at most ${String(maxSurvivors)} allowed ` +
      `(${countsOf(read.counts)})`,
  };
}

/** The most mutants that may time out before the run is read as starved: a tenth of those judged, and never fewer than two. */
const timeoutLimit = (judged: number): number => Math.max(2, judged * 0.1);

const judgedOf = (read: MutationRead): number => read.killed + read.survivors.length;

/**
 * A timeout counts as killed (section 6.4), but a run in which many mutants timed out was starved of CPU or the mutants
 * looped: the tests did not kill them, so nothing can be said of the ones that "survived" nowhere.
 */
function starved(read: MutationRead): boolean {
  return read.counts.timeout > timeoutLimit(judgedOf(read));
}

function starvedReason(read: MutationRead): string {
  const count = `${String(read.counts.timeout)} of ${String(judgedOf(read))}`;
  return `${count} mutants timed out: the machine was starved or a mutant looped`;
}

/** The finding that says so, when the run was starved; a pass only if nothing else in the run failed. */
function starvedFindings(read: MutationRead): RawFinding[] {
  return starved(read)
    ? [
        {
          tool: "webtops",
          rule: "mutation-timeouts",
          verdict: "not-evaluated",
          message: starvedReason(read),
        },
      ]
    : [];
}

function outcome(read: MutationRead, failedAny: boolean): Pick<LayerResult, "verdict" | "reason"> {
  if (failedAny) {
    return { verdict: "fail" };
  }
  if (judgedOf(read) === 0) {
    return {
      verdict: "vacuous",
      reason: "no mutant was judged: every one was excluded, or none was made",
    };
  }
  return starved(read)
    ? { verdict: "not-evaluated", reason: starvedReason(read) }
    : { verdict: "pass" };
}

/** Unexplained survivors over the profile's maximum fail; at or under, they pass and are listed. */
function judge(ctx: LayerContext, read: MutationRead): LayerResult {
  const explained = ctx.explained ?? NONE;
  const open = read.survivors.filter((row) => !explained.has(keyString(row.key)));
  const over = open.length > ctx.config.mutation.maxSurvivors;
  const findings = [
    ...read.unknown.map(unknownFinding),
    ...starvedFindings(read),
    ...open.map((row) => survivorFinding(row, over)),
    ...read.survivors.filter((row) => explained.has(keyString(row.key))).map(acceptedFinding),
    summary(ctx, read, open),
  ];
  const failedAny = findings.some((finding) => finding.verdict === "fail");
  return {
    ...outcome(read, failedAny),
    findings,
    artifacts: {},
    metrics: { mutation: read.counts },
  };
}

function shardSummary(ctx: LayerContext, read: MutationRead, meta: ShardMeta): RawFinding {
  return {
    tool: "webtops",
    rule: "mutation",
    verdict: "pass",
    message:
      `${ctx.config.package} (shard ${String(meta.shard)}/${String(meta.shards)}): ` +
      `${String(read.killed)} mutants killed, ${String(read.survivors.length)} survivors ` +
      `(deferred to join), ${String(read.excluded)} excluded (${countsOf(read.counts)})`,
  };
}

/**
 * Under `--shard`, writes `.web-tops/out/mutation/partial.json` with raw survivors and counts, and defers
 * survivor ledger / `unexplained_survivors_max` judgment to `--join`.
 */
export function judgeShard(ctx: LayerContext, read: MutationRead, meta: ShardMeta): LayerResult {
  writePartial(ctx.outDir, readPartial(meta, read, starved(read), judgedOf(read) === 0));
  const findings = [
    ...read.unknown.map(unknownFinding),
    ...starvedFindings(read),
    ...read.survivors.map((row) => survivorFinding(row, false)),
    shardSummary(ctx, read, meta),
  ];
  const failedAny = findings.some((finding) => finding.verdict === "fail");
  return {
    ...outcome(read, failedAny),
    findings,
    artifacts: {},
    metrics: { mutation: read.counts },
  };
}

export function judgeReport(
  ctx: LayerContext,
  read: MutationRead,
  meta: ShardMeta | undefined,
): LayerResult {
  return meta === undefined ? judge(ctx, read) : judgeShard(ctx, read, meta);
}

const reportError = (error: unknown): string =>
  error instanceof Error ? error.message : "the report could not be read";

export function readReport(
  ctx: LayerContext,
  ts: Ts,
  report: string,
  meta?: ShardMeta,
  parse: (text: string) => unknown = parseJson,
): LayerResult {
  const shown = relativeTo(ctx.cwd, report);
  const text = readOutput(report);
  if (text === undefined) {
    return failed(
      failFinding("stryker", "output-empty", `${shown} was not written`, { file: shown }),
    );
  }
  try {
    const read = readMutation({
      ts,
      report: parse(text),
      text: (file) => readOutput(join(ctx.cwd, file)),
    });
    return judgeReport(ctx, read, meta);
  } catch (error) {
    return failed(
      failFinding("stryker", "output-unparseable", reportError(error), { file: shown }),
    );
  }
}

async function runStryker(
  ctx: LayerContext,
  ts: Ts,
  wrapper: string,
  entries: readonly string[],
  meta?: ShardMeta,
): Promise<LayerResult> {
  const written = writeConfig(ctx, wrapper, entries);
  const budget = ctx.config.mutation.timeBudgetMinutes * MINUTE;
  const result = await runTool(ctx, "stryker", ["run", written.config], budget);
  if (result.failure === "tool-timeout") {
    return overBudget(ctx, meta);
  }
  const trouble = strykerTrouble(result);
  return trouble === undefined ? readReport(ctx, ts, written.report, meta) : failed(trouble);
}

type Inputs = { readonly wrapper: string; readonly ts: Ts } | { readonly stop: LayerResult };

/** What the layer cannot start without: the gate's Vitest wrapper, from the tests layer, and the project's TypeScript. */
function inputsOf(ctx: LayerContext): Inputs {
  const wrapper = ctx.artifacts.get("vitest-config");
  if (wrapper === undefined) {
    throw new Error(
      "the vitest-config input was not handed over: the runner gives a layer what it consumes",
    );
  }
  const typescript = typescriptOf(ctx.cwd);
  return "finding" in typescript
    ? { stop: failed(typescript.finding) }
    : { wrapper, ts: typescript.ts };
}

/** Partitions `entries` for `--shard` and builds the shared metadata recorded in `partial.json`. */
export function shardPlan(
  ctx: LayerContext,
  found: FoundEntries,
): { readonly entries: readonly string[]; readonly meta?: ShardMeta } {
  if (ctx.shard === undefined) {
    return { entries: found.entries };
  }
  const entries = shardOf(found.entries, ctx.shard.index, ctx.shard.count);
  return {
    entries,
    meta: {
      shard: ctx.shard.index,
      shards: ctx.shard.count,
      base: found.base,
      entriesHash: hashEntries(found.entries),
      entriesCount: found.entries.length,
      shardEntries: entries,
    },
  };
}

export function vacuousResult(
  ctx: LayerContext,
  meta: ShardMeta | undefined,
  reason: string | undefined,
): LayerResult {
  if (meta !== undefined) {
    writePartial(ctx.outDir, vacuousPartial(meta));
  }
  return { verdict: "vacuous", reason: reason ?? VACUOUS, findings: [], artifacts: {} };
}

function joinedTimeout(
  reason: string,
  unknown: readonly string[],
  counts: MutationMetric,
): LayerResult {
  const findings = unknown.map(unknownFinding);
  const hasFail = findings.length > 0;
  return {
    verdict: hasFail ? "fail" : "not-evaluated",
    ...(hasFail ? {} : { reason }),
    findings,
    artifacts: {},
    metrics: { mutation: counts },
  };
}

function withShardStarvation(result: LayerResult, reason: string): LayerResult {
  return {
    ...result,
    verdict: "not-evaluated",
    reason,
    findings: [
      { tool: "webtops", rule: "mutation-timeouts", verdict: "not-evaluated", message: reason },
      ...result.findings,
    ],
  };
}

function applyShardStarvation(
  base: LayerResult,
  shardStarved: boolean,
  reason: string,
): LayerResult {
  return shardStarved && base.verdict === "pass" ? withShardStarvation(base, reason) : base;
}

export function judgeJoined(ctx: LayerContext, joined: JoinedMutation): LayerResult {
  if ("finding" in joined) {
    return failed(joined.finding);
  }
  if ("timedOutReason" in joined) {
    return joinedTimeout(joined.timedOutReason, joined.unknown, joined.counts);
  }
  return applyShardStarvation(judge(ctx, joined.read), joined.shardStarved, joined.starvedReason);
}

async function runLocal(ctx: LayerContext): Promise<LayerResult> {
  const inputs = inputsOf(ctx);
  if ("stop" in inputs) {
    return inputs.stop;
  }
  const found = await entriesOf(ctx, inputs.ts);
  if ("stop" in found) {
    return found.stop;
  }
  const planned = shardPlan(ctx, found);
  return planned.entries.length === 0
    ? vacuousResult(ctx, planned.meta, found.vacuousReason)
    : runStryker(ctx, inputs.ts, inputs.wrapper, planned.entries, planned.meta);
}

async function run(ctx: LayerContext): Promise<LayerResult> {
  return ctx.joinDir === undefined ? runLocal(ctx) : judgeJoined(ctx, loadJoined(ctx.joinDir));
}

export const mutationLayer: Layer = {
  id: "mutation",
  gate: 5,
  tier: 1,
  classes: ["ts-library", "ui-components", "astro-site", "web-app", "node-service"],
  requires: ["tests"],
  produces: [],
  consumes: [{ artifact: "vitest-config", from: "tests" }],
  run,
};
