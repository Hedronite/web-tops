import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatText } from "../report/text.ts";
import { writeReport } from "../report/write.ts";
import { checkEnvironment, type Versions } from "./environment.ts";
import { parseGateArgs } from "./options.ts";
import { planGate, runGate } from "./runner.ts";
import type { Exec, GateConfig, Io, Layer } from "./types.ts";

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

/** `CI` counts as set unless it is empty, `0` or `false` (GitHub Actions sends `true`). */
export function isCi(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env["CI"]?.trim().toLowerCase();
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

function planText(plan: ReturnType<typeof planGate>): string {
  const lines = ["webtops gate  dry run: nothing is executed and no report is written", ""];
  for (const item of plan) {
    const what = item.skip === undefined ? "would run" : "skip";
    const why = item.skip === undefined ? "" : `  ${item.skip}`;
    lines.push(`  ${what.padEnd(10)}${item.id.padEnd(14)}tier ${String(item.tier)}${why}`);
  }
  return `${lines.join("\n")}\n`;
}

/** `webtops gate`: usage 2, policy 4, environment 3, config 2, then the run: 0 or 1 (WEB_TOPS.md section 12). */
export async function gateCommand(
  argv: readonly string[],
  io: Io,
  deps: GateDeps,
): Promise<number> {
  const parsed = parseGateArgs(argv);
  if (!parsed.ok) {
    io.err(`webtops gate: ${parsed.error}\n`);
    return 2;
  }
  const { options } = parsed;
  if (options.dryRun && isCi(deps.env)) {
    io.err("webtops gate: --dry-run is refused when CI=true (WEB_TOPS.md section 3.4, rule 6)\n");
    return 4;
  }
  const problems = checkEnvironment(deps.versions);
  if (problems.length > 0) {
    io.err(problems.map((problem) => `webtops gate: ${problem}\n`).join(""));
    return 3;
  }
  const loaded = await deps.loadConfig(deps.cwd);
  if (!loaded.ok) {
    io.err(loaded.errors.map((error) => `webtops gate: ${error}\n`).join(""));
    return 2;
  }
  const { config } = loaded;
  const layers = deps.layers(config);
  const known = new Set(layers.map((layer) => layer.id));
  for (const id of options.only) {
    if (!known.has(id)) {
      io.err(`webtops gate: unknown layer "${id}" (known: ${[...known].join(", ")})\n`);
      return 2;
    }
  }
  if (options.dryRun) {
    io.out(planText(planGate(layers, config, options)));
    return 0;
  }
  const outDir = join(deps.cwd, ".web-tops", "out");
  const reportPath = resolve(deps.cwd, config.reportPath);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  rmSync(reportPath, { force: true });
  const report = await runGate({
    layers,
    config,
    options,
    cwd: deps.cwd,
    env: deps.env,
    exec: deps.exec,
    outDir,
    now: deps.now,
  });
  writeReport(reportPath, report);
  io.out(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
  return report.exit_code;
}
