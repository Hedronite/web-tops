import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTypeScript } from "../../complexity/index.ts";
import type { Ts } from "../../complexity/index.ts";
import type { DiffProvider, Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { keyString } from "../../survivors/key.ts";
import { excludesOf, inScope } from "../coverage/scope.ts";
import { trackedFiles } from "../coverage/tracked.ts";
import {
  exitFinding,
  failFinding,
  launchFailure,
  parseJson,
  readOutput,
  relativeTo,
  runTool,
} from "../hygiene/tooling.ts";
import { RATCHET_REASON } from "../ratchet.ts";
import { strykerConfig } from "./config.ts";
import { readMutation } from "./read.ts";
import type { MutationRead, SurvivorRow } from "./read.ts";
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

type Entries = { readonly entries: readonly string[] } | { readonly stop: LayerResult };

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
  return { entries: tracked.files.filter((file) => inScope(file, excludes)) };
}

/** The diff's ranges, with the functions the changed tests run, widened to whole scored units (R64). */
async function fromDiff(ctx: LayerContext, ts: Ts, diff: DiffProvider): Promise<Entries> {
  const found = await diff({ coveredByTests: true });
  if (found.outcome === "fail") {
    return { stop: failed(failFinding("webtops", "diff-failed", found.reason)) };
  }
  if (found.outcome === "vacuous") {
    return { stop: { verdict: "vacuous", reason: found.reason, findings: [], artifacts: {} } };
  }
  return {
    entries: snapEntries(ts, found.scope.mutate, (file) => readOutput(join(ctx.cwd, file))),
  };
}

async function entriesOf(ctx: LayerContext, ts: Ts): Promise<Entries> {
  const diff = diffOf(ctx);
  return diff === undefined ? allFiles(ctx) : fromDiff(ctx, ts, diff);
}

const VACUOUS = "no source file or function is in scope to mutate";

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
    ...tsconfig,
  };
  writeFileSync(config, JSON.stringify(strykerConfig(plan), null, 2));
  return { config: relativeTo(ctx.cwd, config), report };
}

function overBudget(ctx: LayerContext): LayerResult {
  const minutes = String(ctx.config.mutation.timeBudgetMinutes);
  return {
    verdict: "not-evaluated",
    reason: `stryker was stopped at the time budget of ${minutes} minutes; a run cut short is never a pass`,
    findings: [],
    artifacts: {},
  };
}

function tooLong(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

function survivorFinding(row: SurvivorRow, over: boolean): RawFinding {
  const { key } = row;
  const change = `${key.mutator} \`${tooLong(key.original)}\` -> \`${tooLong(key.replacement)}\``;
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
      `${String(read.excluded)} excluded, at most ${String(maxSurvivors)} allowed`,
  };
}

function outcome(
  ctx: LayerContext,
  read: MutationRead,
  failedAny: boolean,
): Pick<LayerResult, "verdict" | "reason"> {
  if (failedAny) {
    return { verdict: "fail" };
  }
  if (read.killed + read.survivors.length === 0) {
    return {
      verdict: "vacuous",
      reason: "no mutant was judged: every one was excluded, or none was made",
    };
  }
  return ctx.enforce === "ratchet"
    ? { verdict: "not-evaluated", reason: RATCHET_REASON }
    : { verdict: "pass" };
}

/** Unexplained survivors over the profile's maximum fail; at or under, they pass and are listed. */
function judge(ctx: LayerContext, read: MutationRead): LayerResult {
  const explained = ctx.explained ?? NONE;
  const open = read.survivors.filter((row) => !explained.has(keyString(row.key)));
  const over = open.length > ctx.config.mutation.maxSurvivors;
  const findings = [
    ...read.unknown.map(unknownFinding),
    ...open.map((row) => survivorFinding(row, over)),
    summary(ctx, read, open),
  ];
  const failedAny = findings.some((finding) => finding.verdict === "fail");
  return { ...outcome(ctx, read, failedAny), findings, artifacts: {} };
}

function readReport(ctx: LayerContext, ts: Ts, report: string): LayerResult {
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
      report: parseJson(text),
      text: (file) => readOutput(join(ctx.cwd, file)),
    });
    return judge(ctx, read);
  } catch (error) {
    const said = error instanceof Error ? error.message : "the report could not be read";
    return failed(failFinding("stryker", "output-unparseable", said, { file: shown }));
  }
}

async function runStryker(
  ctx: LayerContext,
  ts: Ts,
  wrapper: string,
  entries: readonly string[],
): Promise<LayerResult> {
  const written = writeConfig(ctx, wrapper, entries);
  const budget = ctx.config.mutation.timeBudgetMinutes * MINUTE;
  const result = await runTool(ctx, "stryker", ["run", written.config], budget);
  if (result.failure === "tool-timeout") {
    return overBudget(ctx);
  }
  const launch = launchFailure("stryker", "stryker", result);
  if (launch !== undefined) {
    return failed(launch);
  }
  return result.code === 0
    ? readReport(ctx, ts, written.report)
    : failed(exitFinding("stryker", "stryker-failed", "stryker", result, "stderr"));
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

async function run(ctx: LayerContext): Promise<LayerResult> {
  const inputs = inputsOf(ctx);
  if ("stop" in inputs) {
    return inputs.stop;
  }
  const found = await entriesOf(ctx, inputs.ts);
  if ("stop" in found) {
    return found.stop;
  }
  return found.entries.length === 0
    ? { verdict: "vacuous", reason: VACUOUS, findings: [], artifacts: {} }
    : runStryker(ctx, inputs.ts, inputs.wrapper, found.entries);
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
