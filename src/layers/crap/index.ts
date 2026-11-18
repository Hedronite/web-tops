import { join } from "node:path";
import { ComplexityError, loadTypeScript } from "../../complexity/index.ts";
import type { Ts } from "../../complexity/index.ts";
import { scoreFile, type CrapRow } from "../../crap/score.ts";
import { changedRanges, touched } from "../../crap/scope.ts";
import type { Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { excludesOf, inScope } from "../coverage/scope.ts";
import { trackedFiles } from "../coverage/tracked.ts";
import { failFinding, isRecord, parseJson, readOutput, relativeTo } from "../hygiene/tooling.ts";
import { ratchetHeld } from "../../baseline/state.ts";

/** Gate 4: native CRAP over the tracked files in scope, the counter's complexity joined with statement coverage (section 6.2). */

type Coverage = Readonly<Record<string, unknown>>;

interface Inputs {
  readonly coverage: Coverage;
  readonly files: readonly string[];
  readonly ts: Ts;
}

function failed(finding: RawFinding): LayerResult {
  return { verdict: "fail", findings: [finding], artifacts: {} };
}

/** `coverage-final.json` keyed by project-relative path, whatever form the coverage tool wrote its keys in. */
function readCoverage(
  ctx: LayerContext,
  path: string,
): { readonly coverage: Coverage } | { readonly finding: RawFinding } {
  const shown = relativeTo(ctx.cwd, path);
  const text = readOutput(path);
  if (text === undefined) {
    return {
      finding: failFinding("webtops", "coverage-json-missing", `${shown} does not exist`, {
        file: shown,
      }),
    };
  }
  const value = parseJson(text);
  if (!isRecord(value)) {
    return {
      finding: failFinding("webtops", "output-unparseable", `${shown} is not a coverage map`, {
        file: shown,
      }),
    };
  }
  const keyed = Object.entries(value).map(([key, entry]): [string, unknown] => [
    relativeTo(ctx.cwd, key),
    entry,
  ]);
  return { coverage: Object.fromEntries(keyed) };
}

/** The project's own TypeScript, as the tools are (section 3.1); without it nothing can be counted. */
function typescriptOf(cwd: string): { readonly ts: Ts } | { readonly finding: RawFinding } {
  try {
    return { ts: loadTypeScript(cwd) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "typescript could not be loaded";
    return { finding: failFinding("webtops", "typescript-missing", message) };
  }
}

async function inputsOf(
  ctx: LayerContext,
  path: string,
): Promise<Inputs | { readonly finding: RawFinding }> {
  const read = readCoverage(ctx, path);
  if ("finding" in read) {
    return read;
  }
  const tracked = await trackedFiles(ctx);
  if ("finding" in tracked) {
    return tracked;
  }
  const ts = typescriptOf(ctx.cwd);
  return "finding" in ts ? ts : { coverage: read.coverage, files: tracked.files, ts: ts.ts };
}

function complexityFinding(file: string, error: ComplexityError): RawFinding {
  const place = error.line === undefined ? { file } : { file, line: error.line };
  return failFinding("webtops", "complexity-error", error.message, place);
}

type Scored = { readonly rows: readonly CrapRow[] } | { readonly finding: RawFinding };

function scoreOne(ctx: LayerContext, inputs: Inputs, file: string): Scored {
  const text = readOutput(join(ctx.cwd, file));
  if (text === undefined) {
    return { rows: [] };
  }
  const options = { nullishDiscount: ctx.config.crap.nullishDiscount };
  try {
    return {
      rows: scoreFile({ ts: inputs.ts, file, text, coverage: inputs.coverage[file], options }),
    };
  } catch (error) {
    if (error instanceof ComplexityError) {
      return { finding: complexityFinding(file, error) };
    }
    throw error;
  }
}

/** Every scored function of the tracked files in scope, and a finding for each file the counter could not read. */
function scoreAll(ctx: LayerContext, inputs: Inputs): { rows: CrapRow[]; findings: RawFinding[] } {
  const excludes = excludesOf(ctx.config);
  const outcomes = inputs.files
    .filter((file) => inScope(file, excludes))
    .map((file) => scoreOne(ctx, inputs, file));
  return {
    rows: outcomes.flatMap((outcome) => ("rows" in outcome ? outcome.rows : [])),
    findings: outcomes.flatMap((outcome) => ("finding" in outcome ? [outcome.finding] : [])),
  };
}

/** `--all`, or the config's scope all: every function, whatever the diff says. */
function judgesAll(ctx: LayerContext): boolean {
  return ctx.all === true || ctx.config.crap.scope === "all";
}

type Scoped = { readonly rows: readonly CrapRow[] } | { readonly stop: LayerResult };

/**
 * The functions to judge: all of them under `--all` or scope all, or when no diff can be had; otherwise the ones
 * the diff changed. A diff that cannot be computed fails the layer, with the engine's reason (section 6.4).
 */
async function scopedRows(ctx: LayerContext, rows: readonly CrapRow[]): Promise<Scoped> {
  if (judgesAll(ctx) || ctx.diff === undefined) {
    return { rows };
  }
  const found = await ctx.diff({ coveredByTests: false });
  if (found.outcome === "fail") {
    return { stop: failed(failFinding("webtops", "diff-failed", found.reason)) };
  }
  return { rows: touched(rows, changedRanges(found.scope)) };
}

function pct(coverage: number): string {
  return (coverage * 100).toFixed(1);
}

function overCap(row: CrapRow, cap: number): RawFinding {
  return failFinding(
    "webtops",
    "crap-over-cap",
    `${row.name} has CRAP ${row.crap.toFixed(2)} (complexity ${String(row.complexity)}, statement coverage ${pct(row.coverage)} %), over the cap of ${String(cap)}`,
    { file: row.file, line: row.line },
  );
}

function summary(ctx: LayerContext, rows: readonly CrapRow[]): RawFinding {
  const worst = rows.reduce((top, row) => (row.crap > top.crap ? row : top));
  return {
    tool: "webtops",
    rule: "crap",
    verdict: "pass",
    message: `${ctx.config.package}: ${String(rows.length)} functions scored, the highest CRAP is ${worst.crap.toFixed(2)} (${worst.name}), cap ${String(ctx.config.crap.cap)}`,
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function metricsOf(rows: readonly CrapRow[]): NonNullable<LayerResult["metrics"]> {
  return {
    crap: rows.map((row) => ({
      file: row.file,
      name: row.name,
      line: row.line,
      complexity: row.complexity,
      coverage: round(row.coverage),
      crap: round(row.crap),
    })),
  };
}

/** The verdict: fail on any function over the cap or any file unread; vacuous over nothing. */
function outcome(
  failedAny: boolean,
  rows: readonly CrapRow[],
): Pick<LayerResult, "verdict" | "reason"> {
  if (failedAny) {
    return { verdict: "fail" };
  }
  if (rows.length === 0) {
    return {
      verdict: "vacuous",
      reason: "no function is in scope: the diff touches none, or no tracked file holds one",
    };
  }
  return { verdict: "pass" };
}

function judge(
  ctx: LayerContext,
  rows: readonly CrapRow[],
  parsed: readonly RawFinding[],
): LayerResult {
  // Held to a baseline, a function over the cap is the ratchet's to judge: a new one fails, a legacy one stays.
  const over = ratchetHeld(ctx) ? [] : rows.filter((row) => row.crap > ctx.config.crap.cap);
  const findings = [
    ...parsed,
    ...over.map((row) => overCap(row, ctx.config.crap.cap)),
    ...(rows.length > 0 ? [summary(ctx, rows)] : []),
  ];
  const failedAny = findings.some((finding) => finding.verdict === "fail");
  return { ...outcome(failedAny, rows), findings, artifacts: {}, metrics: metricsOf(rows) };
}

async function run(ctx: LayerContext): Promise<LayerResult> {
  const path = ctx.artifacts.get("coverage-json");
  if (path === undefined) {
    throw new Error(
      "the coverage-json input was not handed over: the runner gives a layer what it consumes",
    );
  }
  const inputs = await inputsOf(ctx, path);
  if ("finding" in inputs) {
    return failed(inputs.finding);
  }
  const scored = scoreAll(ctx, inputs);
  const scoped = await scopedRows(ctx, scored.rows);
  return "stop" in scoped ? scoped.stop : judge(ctx, scoped.rows, scored.findings);
}

export const crapLayer: Layer = {
  id: "crap",
  gate: 4,
  tier: 1,
  classes: ["ts-library", "ui-components", "astro-site", "web-app", "node-service"],
  requires: ["tests"],
  produces: [],
  consumes: [{ artifact: "coverage-json", from: "tests" }],
  run,
};
