import { lstatSync, mkdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { formatText } from "../report/text.ts";
import { realOf, resolveReportPath, writeReport } from "../report/write.ts";
import { checkEnvironment, type Versions } from "./environment.ts";
import { parseGateArgs } from "./options.ts";
import { describeRun, recordTools } from "./run-info.ts";
import { planGate, runGate } from "./runner.ts";
import type { Exec, GateConfig, GateOptions, Io, Layer } from "./types.ts";

export type LoadedConfig =
  | { readonly ok: true; readonly config: GateConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface GateDeps {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exec: Exec;
  readonly versions: Versions;
  /** Validates `web-tops.yaml` and its semantic checks (WEB_TOPS.md section 12) before any layer runs. */
  readonly loadConfig: (cwd: string) => Promise<LoadedConfig>;
  readonly layers: (config: GateConfig) => readonly Layer[];
  readonly now: () => number;
}

/** Everything the run needs once the arguments, the environment and the config have all passed. */
interface Prepared {
  readonly options: GateOptions;
  readonly config: GateConfig;
  readonly layers: readonly Layer[];
  readonly reportPath: string;
}

const CI_OFF: ReadonlySet<string> = new Set(["", "0", "false"]);

/** `CI` counts as set unless it is empty, `0` or `false` (GitHub Actions sends `true`). */
export function isCi(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env["CI"]?.trim().toLowerCase();
  return value !== undefined && !CI_OFF.has(value);
}

function planLine(item: ReturnType<typeof planGate>[number]): string {
  const what = item.skip === undefined ? "would run" : "skip";
  const name =
    item.requiredBy === undefined ? item.id : `${item.id} (required by ${item.requiredBy})`;
  const why = item.skip === undefined ? "" : `  ${item.skip}`;
  return `  ${what.padEnd(10)}${`${name} `.padEnd(15)}tier ${String(item.tier)}${why}`;
}

function planText(plan: ReturnType<typeof planGate>): string {
  const head = "webtops gate  dry run: nothing is executed and no report is written";
  return `${[head, "", ...plan.map(planLine)].join("\n")}\n`;
}

/** Prints each line as a `webtops gate` error and returns the exit code. */
function fail(io: Io, code: number, lines: readonly string[]): number {
  io.err(lines.map((line) => `webtops gate: ${line}\n`).join(""));
  return code;
}

/** Policy 4, then environment 3: both are known before the config is read. */
function precheck(options: GateOptions, io: Io, deps: GateDeps): number | undefined {
  if (options.dryRun && isCi(deps.env)) {
    return fail(io, 4, ["--dry-run is refused when CI=true (WEB_TOPS.md section 3.4, rule 6)"]);
  }
  const problems = checkEnvironment(deps.versions);
  return problems.length > 0 ? fail(io, 3, problems) : undefined;
}

function unknownOnly(only: string | undefined, layers: readonly Layer[]): string | undefined {
  const known = layers.map((layer) => layer.id);
  return only === undefined || known.includes(only)
    ? undefined
    : `unknown layer "${only}" (known: ${known.join(", ")})`;
}

/** The report path as git would list it: relative to the project, and again through any symlink. */
function pathspecs(cwd: string, path: string): string[] {
  const direct = relative(cwd, path);
  const real = relative(realOf(cwd), realOf(path));
  return real.startsWith("..") ? [direct] : [...new Set([direct, real])];
}

/** The pathspec git tracks, if `report.path` lands on a tracked file. Git failing means nothing to protect. */
async function trackedPath(deps: GateDeps, path: string): Promise<string | undefined> {
  const specs = pathspecs(deps.cwd, path);
  const result = await deps.exec("git", ["--literal-pathspecs", "ls-files", "--", ...specs], {
    cwd: deps.cwd,
    env: deps.env,
  });
  return result.code === 0 && result.stdout.trim() !== "" ? specs[0] : undefined;
}

/** Config 2: the report path (inside the directory, not a protected or tracked file), then `--only`. */
async function resolveRun(
  options: GateOptions,
  config: GateConfig,
  io: Io,
  deps: GateDeps,
): Promise<Prepared | number> {
  const target = resolveReportPath(deps.cwd, config.reportPath);
  if (!target.ok) {
    return fail(io, 2, [`web-tops.yaml /report/path: ${target.message}`]);
  }
  const tracked = await trackedPath(deps, target.path);
  if (tracked !== undefined) {
    return fail(io, 2, [
      `web-tops.yaml /report/path: report.path names ${tracked}, a file git tracks`,
    ]);
  }
  const layers = deps.layers(config);
  const unknown = unknownOnly(options.only, layers);
  if (unknown !== undefined) {
    return fail(io, 2, [unknown]);
  }
  return { options, config, layers, reportPath: target.path };
}

async function prepare(options: GateOptions, io: Io, deps: GateDeps): Promise<Prepared | number> {
  const early = precheck(options, io, deps);
  if (early !== undefined) {
    return early;
  }
  const loaded = await deps.loadConfig(deps.cwd);
  if (!loaded.ok) {
    return fail(io, 2, loaded.errors);
  }
  return resolveRun(options, loaded.config, io, deps);
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** A symlinked `.web-tops` or `.web-tops/out` would send the wipe into another directory (R37): exit 3, nothing deleted. */
function symlinkRefusal(cwd: string): string | undefined {
  const linked = [".web-tops", ".web-tops/out"].find((name) => isSymlink(join(cwd, name)));
  return linked === undefined ? undefined : `refusing to clear a symlinked ${linked}`;
}

/** Each real run wipes `.web-tops/out` and any stale report first, so no layer reads a file from an earlier run. */
async function execute(prepared: Prepared, io: Io, deps: GateDeps): Promise<number> {
  const refusal = symlinkRefusal(deps.cwd);
  if (refusal !== undefined) {
    return fail(io, 3, [refusal]);
  }
  const outDir = join(deps.cwd, ".web-tops", "out");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  rmSync(prepared.reportPath, { force: true });
  const tools = recordTools(deps.exec);
  const report = await runGate({
    layers: prepared.layers,
    config: prepared.config,
    options: prepared.options,
    cwd: deps.cwd,
    env: deps.env,
    exec: tools.exec,
    outDir,
    now: deps.now,
    describe: () =>
      describeRun({ cwd: deps.cwd, env: deps.env, exec: deps.exec, used: tools.used() }),
  });
  writeReport(prepared.reportPath, report);
  io.out(prepared.options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
  return report.exit_code;
}

async function conclude(prepared: Prepared, io: Io, deps: GateDeps): Promise<number> {
  if (prepared.options.dryRun) {
    io.out(planText(planGate(prepared.layers, prepared.config, prepared.options)));
    return 0;
  }
  return execute(prepared, io, deps);
}

/** `webtops gate`: usage 2, policy 4, environment 3, config 2, then the run: 0 or 1 (WEB_TOPS.md section 12). */
export async function gateCommand(
  argv: readonly string[],
  io: Io,
  deps: GateDeps,
): Promise<number> {
  const parsed = parseGateArgs(argv);
  if (!parsed.ok) {
    return fail(io, 2, [parsed.error]);
  }
  const prepared = await prepare(parsed.options, io, deps);
  return typeof prepared === "number" ? prepared : conclude(prepared, io, deps);
}
