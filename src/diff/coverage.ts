import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Exec } from "../gate/types.ts";
import { COVERAGE_INCLUDE, DEFAULT_COVERAGE_EXCLUDES } from "../layers/coverage/scope.ts";
import { writeKitConfig } from "../layers/tests/index.ts";
import { innermostAt } from "./functions.ts";
import type { CoverageMap, FunctionHit, FunctionSpan } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const defined = <T>(value: T | undefined): value is T => value !== undefined;

function lineAt(loc: unknown, side: string): number | undefined {
  const position = isRecord(loc) ? loc[side] : undefined;
  const line = isRecord(position) ? position["line"] : undefined;
  return typeof line === "number" ? line : undefined;
}

function locOf(entry: unknown): unknown {
  return isRecord(entry) ? entry["loc"] : undefined;
}

function hitOf(entry: unknown, count: unknown): FunctionHit | undefined {
  const start = lineAt(locOf(entry), "start");
  const end = lineAt(locOf(entry), "end");
  return start !== undefined && end !== undefined && typeof count === "number"
    ? { start, end, hits: count }
    : undefined;
}

function hitsOf(file: Record<string, unknown>): readonly FunctionHit[] | undefined {
  const map = file["fnMap"];
  const counts = file["f"];
  if (!isRecord(map) || !isRecord(counts)) return undefined;
  const found = Object.entries(map)
    .map(([id, entry]) => hitOf(entry, counts[id]))
    .filter(defined);
  return found.length === Object.keys(map).length ? found : undefined;
}

/** A path relative to the first root that holds it (a temp directory has two spellings on macOS: /var and /private/var). */
function relative(path: string, roots: readonly string[]): string {
  const root = roots.find((candidate) => path.startsWith(`${candidate}/`));
  return root === undefined ? path : path.slice(root.length + 1);
}

function hitsByFile(
  value: Record<string, unknown>,
  roots: readonly string[],
): CoverageMap | undefined {
  const map = new Map<string, readonly FunctionHit[]>();
  for (const [path, file] of Object.entries(value)) {
    const hits = isRecord(file) ? hitsOf(file) : undefined;
    if (hits === undefined) return undefined;
    map.set(relative(path, roots), hits);
  }
  return map;
}

/**
 * Reads Istanbul `coverage-final.json` into the functions each file ran, by path relative to `root`.
 * Anything that is not that shape is undefined.
 */
export function parseCoverage(
  value: unknown,
  root: string | readonly string[] = [],
): CoverageMap | undefined {
  return isRecord(value) ? hitsByFile(value, typeof root === "string" ? [root] : root) : undefined;
}

/** The functions, of those the spans list, that ran: each hit goes to the smallest function-or-module span that holds it. */
export function coveredSpans(
  spans: readonly FunctionSpan[],
  hits: readonly FunctionHit[],
): readonly FunctionSpan[] {
  const ran = hits.filter((hit) => hit.hits > 0);
  const holders = ran.map((hit) => innermostHolding(spans, hit));
  const keys = new Set(holders.filter((span) => span !== undefined).map((span) => span.key));
  return spans.filter((span) => keys.has(span.key) && !span.key.endsWith("::<module>"));
}

function innermostHolding(
  spans: readonly FunctionSpan[],
  hit: FunctionHit,
): FunctionSpan | undefined {
  const inside = spans.filter((span) => span.start <= hit.start && hit.end <= span.end);
  return innermostAt(inside, hit.start);
}

export interface CoverageRun {
  readonly cwd: string;
  readonly exec: Exec;
  /** Reasoned exclusions from `web-tops.yaml` (`gates.coverage.exclude`), beyond the defaults of section 6.1. */
  readonly exclude?: readonly string[];
  /** Extra Vitest arguments. */
  readonly args?: readonly string[];
}

function coverageArgs(
  testFiles: readonly string[],
  config: string,
  out: string,
  run: CoverageRun,
): string[] {
  const excludes = [...DEFAULT_COVERAGE_EXCLUDES, ...(run.exclude ?? [])];
  return [
    "run",
    ...testFiles,
    `--config=${config}`,
    "--coverage",
    "--coverage.provider=v8",
    `--coverage.include=${COVERAGE_INCLUDE}`,
    "--coverage.reporter=json",
    `--coverage.reportsDirectory=${out}`,
    ...excludes.map((glob) => `--coverage.exclude=${glob}`),
    ...(run.args ?? []),
  ];
}

/**
 * Runs Vitest on test files, all in one run, with the gate's own config (the project's, without coverage thresholds)
 * and the gate's coverage include and exclude, as the tests layer does, and reads what ran from the JSON report: a
 * function is covered when any of the files ran it. A run that fails, or leaves no coverage file, is undefined: what
 * the files cover is then not known, and which of them is the cause is not either.
 */
export async function vitestCoverageOfMany(
  testFiles: readonly string[],
  run: CoverageRun,
): Promise<CoverageMap | undefined> {
  const out = mkdtempSync(join(tmpdir(), "wt-cov-"));
  try {
    const config = writeKitConfig(run.cwd, out);
    const args = coverageArgs(testFiles, config, out, run);
    const result = await run.exec(join(run.cwd, "node_modules/.bin/vitest"), args, {
      cwd: run.cwd,
    });
    return result.code === 0 ? readCoverage(out, run.cwd) : undefined;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** What one test file covers: a run of that file alone. */
export const vitestCoverageOf = (
  testFile: string,
  run: CoverageRun,
): Promise<CoverageMap | undefined> => vitestCoverageOfMany([testFile], run);

/** The work tree under its given name and under its real path, when it has one. */
function rootsOf(root: string): readonly string[] {
  try {
    return [root, realpathSync(root)];
  } catch {
    return [root];
  }
}

function readCoverage(dir: string, root: string): CoverageMap | undefined {
  try {
    const json: unknown = JSON.parse(readFileSync(join(dir, "coverage-final.json"), "utf8"));
    return parseCoverage(json, rootsOf(root));
  } catch {
    return undefined;
  }
}
