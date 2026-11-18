import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Exec } from "../gate/types.ts";
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

function relative(path: string, root: string | undefined): string {
  return root !== undefined && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function hitsByFile(
  value: Record<string, unknown>,
  root: string | undefined,
): CoverageMap | undefined {
  const map = new Map<string, readonly FunctionHit[]>();
  for (const [path, file] of Object.entries(value)) {
    const hits = isRecord(file) ? hitsOf(file) : undefined;
    if (hits === undefined) return undefined;
    map.set(relative(path, root), hits);
  }
  return map;
}

/**
 * Reads Istanbul `coverage-final.json` into the functions each file ran, by path relative to `root`.
 * Anything that is not that shape is undefined.
 */
export function parseCoverage(value: unknown, root?: string): CoverageMap | undefined {
  return isRecord(value) ? hitsByFile(value, root) : undefined;
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
  /** Extra Vitest arguments, such as the gate's own config. */
  readonly args?: readonly string[];
}

/**
 * Runs Vitest on one test file with the JSON coverage reporter and reads what ran. A run that fails, or
 * leaves no coverage file, is undefined: what the test covers is then not known.
 */
export async function vitestCoverageOf(
  testFile: string,
  run: CoverageRun,
): Promise<CoverageMap | undefined> {
  const out = mkdtempSync(join(tmpdir(), "wt-cov-"));
  try {
    const args = [
      "run",
      testFile,
      "--coverage",
      "--coverage.reporter=json",
      `--coverage.reportsDirectory=${out}`,
      ...(run.args ?? []),
    ];
    const result = await run.exec(join(run.cwd, "node_modules/.bin/vitest"), args, {
      cwd: run.cwd,
    });
    return result.code === 0 ? readCoverage(out, run.cwd) : undefined;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function readCoverage(dir: string, root: string): CoverageMap | undefined {
  try {
    const json: unknown = JSON.parse(readFileSync(join(dir, "coverage-final.json"), "utf8"));
    return parseCoverage(json, root);
  } catch {
    return undefined;
  }
}
