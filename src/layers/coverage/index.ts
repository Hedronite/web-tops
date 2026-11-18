import type { RawFinding } from "../../report/findings.ts";
import type { Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import { join } from "node:path";
import { arrayOf, parseJson, readOutput, failFinding, relativeTo } from "../hygiene/tooling.ts";
import { RATCHET_REASON } from "../ratchet.ts";
import { coverageHints } from "./hints.ts";
import { trackedFiles } from "./tracked.ts";
import {
  isBelow,
  parseRecords,
  percent,
  totalsOf,
  type LcovRecord,
  type LcovTotals,
} from "./lcov.ts";
import { excludesOf, inScope } from "./scope.ts";

/** What gate 3 reads from gate 2's run: the totals over the records in scope, and every file that has a record. */
interface Profile {
  readonly totals: LcovTotals;
  /** The records in scope, by file: the per-file numbers the report carries (section 6.6). */
  readonly rows: readonly LcovRecord[];
  readonly records: ReadonlySet<string>;
}

function failedResult(finding: RawFinding): LayerResult {
  return { verdict: "fail", findings: [finding], artifacts: {} };
}

function byFile(left: LcovRecord, right: LcovRecord): number {
  return left.file < right.file ? -1 : 1;
}

/** The LCOV must exist and have lines (`test -s`, and a profile that is not empty). */
function readProfile(ctx: LayerContext, path: string): Profile | LayerResult {
  const shown = relativeTo(ctx.cwd, path);
  const text = readOutput(path);
  if (text === undefined) {
    return failedResult(
      failFinding("webtops", "lcov-missing", `${shown} does not exist`, { file: shown }),
    );
  }
  const all = parseRecords(text).map((entry) => ({
    ...entry,
    file: relativeTo(ctx.cwd, entry.file),
  }));
  const excludes = excludesOf(ctx.config);
  const rows = all.filter((entry) => inScope(entry.file, excludes)).sort(byFile);
  const totals = totalsOf(rows);
  if (totals.files === 0 || totals.found === 0) {
    return failedResult(
      failFinding("webtops", "lcov-empty", `${shown} holds no instrumented lines in scope`, {
        file: shown,
      }),
    );
  }
  return { totals, rows, records: new Set(all.map((entry) => entry.file)) };
}

function isProfile(value: Profile | LayerResult): value is Profile {
  return "totals" in value;
}

/** Why a tracked file in scope has no record: a Vitest setup file is never instrumented, any other file is not imported. */
function whyMissing(file: string, shown: string, setup: ReadonlySet<string>): string {
  const head = `${file} is tracked and in scope but has no SF record in ${shown}`;
  return setup.has(file)
    ? `${head}: it is a Vitest setup file, and Vitest does not instrument setup files; exclude it with a reason in gates.coverage.exclude`
    : `${head}: no test imports it`;
}

/** The files the tests layer named as Vitest setup files; an input that cannot be read names none. */
function setupFilesOf(ctx: LayerContext): ReadonlySet<string> {
  const path = ctx.artifacts.get("setup-files");
  const listed = path === undefined ? [] : arrayOf(parseJson(readOutput(path)));
  return new Set(listed.flatMap((entry) => (typeof entry === "string" ? [entry] : [])));
}

/** A tracked file in scope with no `SF:` record fails: coverage would otherwise be computed without it. */
function missingRecords(
  ctx: LayerContext,
  files: readonly string[],
  records: ReadonlySet<string>,
  shown: string,
): RawFinding[] {
  const setup = setupFilesOf(ctx);
  const excludes = excludesOf(ctx.config);
  return files
    .filter((file) => inScope(file, excludes) && !records.has(file))
    .map((file) =>
      failFinding("webtops", "no-coverage-record", whyMissing(file, shown, setup), { file }),
    );
}

/** The package's number: what the report's per-file rows add up to. */
function summaryOf(name: string, totals: LcovTotals): string {
  return `${name}: ${percent(totals)} % of ${String(totals.found)} lines in ${String(totals.files)} files`;
}

function floorFindings(name: string, totals: LcovTotals, floor: number): RawFinding[] {
  const summary = summaryOf(name, totals);
  return isBelow(totals, floor)
    ? [
        failFinding(
          "webtops",
          "coverage-below-floor",
          `${summary} is below the floor of ${String(floor)} %`,
        ),
      ]
    : [
        {
          tool: "webtops",
          rule: "coverage",
          verdict: "pass",
          message: `${summary}, floor ${String(floor)} %`,
        },
      ];
}

function ratchetFindings(name: string, totals: LcovTotals): RawFinding[] {
  const message = `${summaryOf(name, totals)}; the ratchet needs a baseline, which lands in M2`;
  return [{ tool: "webtops", rule: "coverage", verdict: "pass", message }];
}

/** Under `ratchet` the floor is the baseline, which lands in M2; otherwise it is the class floor. */
function judgeFindings(ctx: LayerContext, totals: LcovTotals): RawFinding[] {
  return ctx.enforce === "ratchet"
    ? ratchetFindings(ctx.config.package, totals)
    : floorFindings(ctx.config.package, totals, ctx.config.coverage.linesFloor);
}

function outcome(failed: boolean, ratchet: boolean): Pick<LayerResult, "verdict" | "reason"> {
  if (failed) {
    return { verdict: "fail" };
  }
  return ratchet ? { verdict: "not-evaluated", reason: RATCHET_REASON } : { verdict: "pass" };
}

/** One pass finding per coverage hint in a tracked file in scope: the census counts what the profile never saw (R60). */
function hintFindings(ctx: LayerContext, files: readonly string[]): RawFinding[] {
  const excludes = excludesOf(ctx.config);
  return files
    .filter((file) => inScope(file, excludes))
    .flatMap((file) =>
      coverageHints(readOutput(join(ctx.cwd, file)) ?? "").map((hint): RawFinding => ({
        tool: "webtops",
        rule: `coverage-hint/${hint.kind.replace("-ignore", "")}`,
        verdict: "pass",
        message: `a ${hint.kind.replace("-", " ")} hint takes lines out of the coverage profile`,
        file,
        line: hint.line,
      })),
    );
}

async function scopeFindings(
  ctx: LayerContext,
  profile: Profile,
  path: string,
): Promise<RawFinding[]> {
  const tracked = await trackedFiles(ctx);
  if (!("files" in tracked)) {
    return [tracked.finding];
  }
  return [
    ...missingRecords(ctx, tracked.files, profile.records, relativeTo(ctx.cwd, path)),
    ...hintFindings(ctx, tracked.files),
  ];
}

/** Gate 3: from gate 2's run. The profile is complete, and under `hard` and `advisory` it meets the floor. */
async function run(ctx: LayerContext): Promise<LayerResult> {
  const path = ctx.artifacts.get("lcov");
  if (path === undefined) {
    throw new Error(
      "the lcov input was not handed over: the runner gives a layer what it consumes",
    );
  }
  const profile = readProfile(ctx, path);
  if (!isProfile(profile)) {
    return profile;
  }
  const scope = await scopeFindings(ctx, profile, path);
  const findings = [...scope, ...judgeFindings(ctx, profile.totals)];
  const failed = findings.some((finding) => finding.verdict === "fail");
  const coverage = profile.rows.map((row) => ({
    file: row.file,
    lines_found: row.found,
    lines_hit: row.hit,
  }));
  return {
    ...outcome(failed, ctx.enforce === "ratchet"),
    findings,
    artifacts: {},
    metrics: { coverage },
  };
}

export const coverageLayer: Layer = {
  id: "coverage",
  gate: 3,
  tier: 1,
  classes: ["ts-library", "ui-components", "astro-site", "web-app", "node-service"],
  requires: ["tests"],
  produces: [],
  consumes: [
    { artifact: "lcov", from: "tests" },
    { artifact: "setup-files", from: "tests" },
  ],
  run,
};
