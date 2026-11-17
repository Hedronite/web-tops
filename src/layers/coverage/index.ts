import type { Finding } from "../../report/types.ts";
import type { Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import {
  capFindings,
  exitFinding,
  launchFailure,
  readOutput,
  failFinding,
  relativeTo,
} from "../hygiene/tooling.ts";
import { isBelow, parseRecords, percent, totalsOf, type LcovTotals } from "./lcov.ts";
import { excludesOf, inScope } from "./scope.ts";

const RATCHET_REASON = "baseline: M2";

/** What gate 3 reads from gate 2's run: the totals over the records in scope, and every file that has a record. */
interface Profile {
  readonly totals: LcovTotals;
  readonly records: ReadonlySet<string>;
}

function failedResult(finding: Finding): LayerResult {
  return { verdict: "fail", findings: [finding], artifacts: {} };
}

/** The LCOV must exist and have lines (`test -s`, and a profile that is not empty). */
function readProfile(ctx: LayerContext, path: string): Profile | LayerResult {
  const shown = relativeTo(ctx.cwd, path);
  const text = readOutput(path);
  if (text === undefined) {
    return failedResult(failFinding("lcov-missing", `${shown} does not exist`, { file: shown }));
  }
  const all = parseRecords(text).map((entry) => ({
    ...entry,
    file: relativeTo(ctx.cwd, entry.file),
  }));
  const excludes = excludesOf(ctx.config);
  const totals = totalsOf(all.filter((entry) => inScope(entry.file, excludes)));
  if (totals.files === 0 || totals.found === 0) {
    return failedResult(
      failFinding("lcov-empty", `${shown} holds no instrumented lines in scope`, { file: shown }),
    );
  }
  return { totals, records: new Set(all.map((entry) => entry.file)) };
}

function isProfile(value: Profile | LayerResult): value is Profile {
  return "totals" in value;
}

/** The files git tracks, so a file no test imports cannot leave the denominator. */
async function trackedFiles(
  ctx: LayerContext,
): Promise<{ readonly files: string[] } | { readonly finding: Finding }> {
  const result = await ctx.exec("git", ["ls-files", "-z"], { cwd: ctx.cwd, env: ctx.env });
  const launch = launchFailure("git", result);
  if (launch !== undefined) {
    return { finding: launch };
  }
  if (result.code !== 0) {
    return { finding: exitFinding("git-ls-files-failed", "git ls-files", result, "stderr") };
  }
  return { files: result.stdout.split("\0").filter((file) => file !== "") };
}

/** A tracked file in scope with no `SF:` record fails: coverage would otherwise be computed without it. */
function missingRecords(
  ctx: LayerContext,
  files: readonly string[],
  records: ReadonlySet<string>,
  shown: string,
): Finding[] {
  const excludes = excludesOf(ctx.config);
  return files
    .filter((file) => inScope(file, excludes) && !records.has(file))
    .map((file) =>
      failFinding(
        "no-coverage-record",
        `${file} is tracked and in scope but has no SF record in ${shown}: no test imports it`,
        { file },
      ),
    );
}

function summaryOf(totals: LcovTotals): string {
  return `${percent(totals)} % of ${String(totals.found)} lines in ${String(totals.files)} files`;
}

function floorFindings(totals: LcovTotals, floor: number): Finding[] {
  const summary = summaryOf(totals);
  return isBelow(totals, floor)
    ? [failFinding("coverage-below-floor", `${summary} is below the floor of ${String(floor)} %`)]
    : [{ rule: "coverage", verdict: "pass", message: `${summary}, floor ${String(floor)} %` }];
}

function ratchetFindings(totals: LcovTotals): Finding[] {
  const message = `${summaryOf(totals)}; the ratchet needs a baseline, which lands in M2`;
  return [{ rule: "coverage", verdict: "pass", message }];
}

/** Under `ratchet` the floor is the baseline, which lands in M2; otherwise it is the class floor. */
function judgeFindings(ctx: LayerContext, totals: LcovTotals): Finding[] {
  return ctx.enforce === "ratchet"
    ? ratchetFindings(totals)
    : floorFindings(totals, ctx.config.coverage.linesFloor);
}

function outcome(failed: boolean, ratchet: boolean): Pick<LayerResult, "verdict" | "reason"> {
  if (failed) {
    return { verdict: "fail" };
  }
  return ratchet ? { verdict: "not-evaluated", reason: RATCHET_REASON } : { verdict: "pass" };
}

async function scopeFindings(
  ctx: LayerContext,
  profile: Profile,
  path: string,
): Promise<Finding[]> {
  const tracked = await trackedFiles(ctx);
  return "files" in tracked
    ? missingRecords(ctx, tracked.files, profile.records, relativeTo(ctx.cwd, path))
    : [tracked.finding];
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
  const findings = capFindings([...scope, ...judgeFindings(ctx, profile.totals)], "coverage");
  const failed = findings.some((finding) => finding.verdict === "fail");
  return { ...outcome(failed, ctx.enforce === "ratchet"), findings, artifacts: {} };
}

export const coverageLayer: Layer = {
  id: "coverage",
  gate: 3,
  tier: 1,
  classes: ["ts-library", "ui-components", "astro-site", "web-app", "node-service"],
  requires: ["tests"],
  produces: [],
  consumes: [{ artifact: "lcov", from: "tests" }],
  run,
};
