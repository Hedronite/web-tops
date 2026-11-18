import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateReport, type GateReport } from "../config/report.ts";
import { runGit } from "../diff/git.ts";
import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import { canonicalJson } from "./canonical.ts";
import { capFor } from "./cap.ts";
import { ratchetBreaches } from "./compare.ts";
import { projectBaseline } from "./project.ts";
import { readBaseline } from "./read.ts";
import type { Baseline } from "./types.ts";

export interface WriteOptions {
  readonly cwd: string;
  /** The last report, relative to `cwd` (`report.path` in `web-tops.yaml`). */
  readonly reportPath: string;
  /** The baseline's path, relative to `cwd`. */
  readonly baselinePath: string;
  readonly exec?: Exec;
}

export type WriteResult =
  | { readonly ok: true; readonly path: string; readonly baseline: Baseline }
  | { readonly ok: false; readonly reason: string };

const refuse = (reason: string): WriteResult => ({ ok: false, reason });

type ReportRead =
  | { readonly ok: true; readonly report: GateReport }
  | { readonly ok: false; readonly reason: string };

function readReport(cwd: string, path: string): ReportRead {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(cwd, path), "utf8"));
  } catch {
    return { ok: false, reason: `no report at ${path}, or it is not JSON; run webtops gate first` };
  }
  const checked = validateReport(value);
  return checked.ok
    ? { ok: true, report: checked.value }
    : {
        ok: false,
        reason: `${path} is not a valid report: ${checked.problems.map((problem) => problem.message).join("; ")}`,
      };
}

/** A path git reports that is not the baseline or the gate's own output. */
function isOutside(line: string, baselinePath: string): boolean {
  const path = line.slice(3);
  return !(path.startsWith(".web-tops/") || path.includes("/.web-tops/") || path === baselinePath);
}

async function shaProblem(
  exec: Exec,
  cwd: string,
  report: GateReport,
): Promise<string | undefined> {
  const head = await runGit(exec, cwd, ["rev-parse", "HEAD"]);
  if (!head.ok) return `cannot read HEAD: ${head.reason}`;
  return report.run.sha === head.value
    ? undefined
    : `the report is for commit ${String(report.run.sha)}, and HEAD is ${head.value}; run webtops gate again`;
}

async function dirtyProblem(
  exec: Exec,
  cwd: string,
  baselinePath: string,
): Promise<string | undefined> {
  const status = await runGit(exec, cwd, ["status", "--porcelain"]);
  if (!status.ok) return `cannot read the work tree: ${status.reason}`;
  const dirty = status.value
    .split("\n")
    .filter((line) => line.trim() !== "" && isOutside(line, baselinePath));
  return dirty.length === 0
    ? undefined
    : `the work tree has uncommitted changes (${String(dirty.length)}); commit or stash them, then run webtops gate again`;
}

/** Why the work tree is not the one the report judged, or undefined: the report's commit is HEAD and the tree is clean. */
async function treeProblem(
  exec: Exec,
  cwd: string,
  report: GateReport,
  baselinePath: string,
): Promise<string | undefined> {
  return (await shaProblem(exec, cwd, report)) ?? (await dirtyProblem(exec, cwd, baselinePath));
}

/** Why the new baseline is not allowed over the one that is there, or undefined. */
function looserProblem(
  cwd: string,
  baselinePath: string,
  projected: Baseline,
  cap: number,
): string | undefined {
  const existing = readBaseline(cwd, baselinePath);
  if (!existing.ok) return existing.reason.includes("missing") ? undefined : existing.reason;
  const breaches = ratchetBreaches(existing.baseline, projected, cap);
  return breaches.length === 0
    ? undefined
    : `the new baseline would be looser than ${baselinePath}: ${breaches.map((breach) => breach.message).join("; ")}`;
}

async function refusalFor(
  options: WriteOptions,
  exec: Exec,
  report: GateReport,
): Promise<string | undefined> {
  if (report.passed !== true) return "the last run did not pass, so it is not a baseline to keep";
  const cap = capFor(report.class);
  if (cap === undefined) return `class ${report.class} has no launch profile`;
  const tree = await treeProblem(exec, options.cwd, report, options.baselinePath);
  if (tree !== undefined) return tree;
  return looserProblem(options.cwd, options.baselinePath, projectBaseline(report), cap);
}

function store(options: WriteOptions, baseline: Baseline): WriteResult {
  const path = resolve(options.cwd, options.baselinePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalJson(baseline));
  return { ok: true, path: options.baselinePath, baseline };
}

/**
 * `webtops baseline`: the only writer of the baseline file (WEB_TOPS.md sections 6.7 and 12). It projects the last
 * report and writes it, if that report passed, belongs to HEAD, the work tree is clean, and the result is not
 * looser than the baseline already there. Nothing else is read.
 */
export async function writeBaseline(options: WriteOptions): Promise<WriteResult> {
  const exec = options.exec ?? realExec;
  const read = readReport(options.cwd, options.reportPath);
  if (!read.ok) return refuse(read.reason);
  const refusal = await refusalFor(options, exec, read.report);
  return refusal === undefined ? store(options, projectBaseline(read.report)) : refuse(refusal);
}
