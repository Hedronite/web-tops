import { join } from "node:path";
import { writeBaseline, type WriteResult } from "../baseline/write.ts";
import { loadConfig } from "../config/validate.ts";
import type { Validated, WebTopsConfig } from "../config/types.ts";
import type { Io } from "./io.ts";

const USAGE =
  "usage: webtops baseline\nwrites .web-tops/baseline.json from the last report, after a passing run on a clean tree\n";

function total(counts: Readonly<Record<string, Readonly<Record<string, number>>>>): number {
  const sums = Object.values(counts).map((files) =>
    Object.values(files).reduce((a, b) => a + b, 0),
  );
  return sums.reduce((a, b) => a + b, 0);
}

const isHelp = (argv: readonly string[]): boolean => argv.length === 1 && argv[0] === "--help";

function argsExit(argv: readonly string[], io: Io): number | undefined {
  if (argv.length === 0) return undefined;
  if (isHelp(argv)) {
    io.out(USAGE);
    return 0;
  }
  io.err(`webtops baseline: unexpected argument ${argv[0] ?? ""}\n${USAGE}`);
  return 2;
}

function firstProblem(config: Validated<WebTopsConfig>): string {
  return config.ok ? "" : `web-tops.yaml: ${config.problems[0]?.message ?? "cannot be read"}`;
}

/** The config, or why the command stops: a config that does not load, or one that runs hard. */
function configured(cwd: string): WebTopsConfig | string {
  const config = loadConfig(join(cwd, "web-tops.yaml"));
  if (!config.ok) return firstProblem(config);
  const hard = "this config runs hard, whose gate never reads a baseline; use ratchet to adopt";
  return config.value.enforce === "hard" ? hard : config.value;
}

function summary(result: Extract<WriteResult, { ok: true }>): string {
  const { baseline } = result;
  const parts = [
    `${String(Object.keys(baseline.crap).length)} functions`,
    `${String(Object.keys(baseline.coverage).length)} packages`,
    `${String(total(baseline.findings))} findings`,
  ];
  return `wrote ${result.path}: ${parts.join(", ")}\n`;
}

/**
 * `webtops baseline` (WEB_TOPS.md section 12): writes the baseline from the last report, and is the only thing that
 * does. It refuses (exit 2) unless the last run passed, was made at HEAD, and the tree is clean, and for a class that
 * runs `hard`, whose gate never reads a baseline.
 */
export async function runBaselineCli(argv: readonly string[], io: Io): Promise<number> {
  const early = argsExit(argv, io);
  if (early !== undefined) return early;
  const config = configured(io.cwd);
  if (typeof config === "string") {
    io.err(`webtops baseline: ${config}\n`);
    return 2;
  }
  const result = await writeBaseline({
    cwd: io.cwd,
    reportPath: config.report.path,
    baselinePath: config.baseline,
  });
  if (!result.ok) {
    io.err(`webtops baseline: ${result.reason}\n`);
    return 2;
  }
  io.out(summary(result));
  return 0;
}
