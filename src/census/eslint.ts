import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Exec } from "../gate/types.ts";
import type { Levels } from "./config.ts";

/** What the census needs from a run: where it is, how to start a process, and a folder to write in. */
export interface Runner {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exec: Exec;
  readonly outDir: string;
}

export interface EslintFacts {
  /** `isPathIgnored` for each file asked about. */
  readonly ignored: ReadonlyMap<string, boolean>;
  readonly levels: Levels;
}

export type EslintRead =
  | { readonly ok: true; readonly facts: EslintFacts }
  | { readonly ok: false; readonly message: string };

const CONFIGS = ["js", "mjs", "cjs", "ts", "mts", "cts"].map((ext) => `eslint.config.${ext}`);

/** True when the project has a flat ESLint config: without one there is no config-level ESLint census to read. */
export const hasEslintConfig = (cwd: string): boolean =>
  CONFIGS.some((name) => existsSync(join(cwd, name)));

const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run under Node, from the project, so its ESLint is the one the gate lints with (WEB_TOPS.md section 3.1) and the
 * config loads as it does for `eslint`. It prints `{ ignored, levels }` as JSON: for each file, whether ESLint
 * ignores it, and the effective level of every rule when it does not.
 */
const SCRIPT = `
import { readFileSync } from "node:fs";
const { ESLint } = await import("eslint");
const files = JSON.parse(readFileSync(process.env.WEBTOPS_CENSUS_FILES, "utf8"));
const eslint = new ESLint({ cwd: process.cwd() });
const NAMED = { off: 0, warn: 1, error: 2 };
const levelOf = (value) => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "number" ? first : (NAMED[first] ?? 0);
};
const ignored = {};
const levels = {};
for (const file of files) {
  ignored[file] = await eslint.isPathIgnored(file);
  if (ignored[file]) continue;
  const config = await eslint.calculateConfigForFile(file);
  if (!config) continue;
  levels[file] = Object.fromEntries(Object.entries(config.rules ?? {}).map(([rule, value]) => [rule, levelOf(value)]));
}
process.stdout.write(JSON.stringify({ ignored, levels }));
`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function levelsOf(raw: unknown): Levels {
  const entries = isRecord(raw) ? Object.entries(raw) : [];
  return new Map(
    entries.map(([file, rules]): [string, Map<string, number>] => [
      file,
      new Map(
        (isRecord(rules) ? Object.entries(rules) : []).flatMap(
          ([rule, level]): [string, number][] => (typeof level === "number" ? [[rule, level]] : []),
        ),
      ),
    ]),
  );
}

function ignoredOf(raw: unknown): Map<string, boolean> {
  const entries = isRecord(raw) ? Object.entries(raw) : [];
  return new Map(entries.map(([file, left]): [string, boolean] => [file, left === true]));
}

/** Reads what the script printed, or says it was not what was expected. */
export function parseFacts(output: string): EslintRead {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!isRecord(parsed))
      return { ok: false, message: "ESLint's census output was not an object" };
    return {
      ok: true,
      facts: { ignored: ignoredOf(parsed["ignored"]), levels: levelsOf(parsed["levels"]) },
    };
  } catch {
    return { ok: false, message: "ESLint's census output was not JSON" };
  }
}

/**
 * Asks the project's ESLint about each file: ignored or not, and the effective level of each rule. Runs once, in
 * a Node process, for all the files. A config that does not load, or a missing ESLint, is the answer `ok: false`.
 */
export async function eslintFacts(runner: Runner, files: readonly string[]): Promise<EslintRead> {
  const folder = join(runner.outDir, "census");
  mkdirSync(folder, { recursive: true });
  const list = join(folder, "eslint-files.json");
  writeFileSync(list, JSON.stringify(files));
  const result = await runner.exec("node", ["--input-type=module", "-e", SCRIPT], {
    cwd: runner.cwd,
    env: { ...runner.env, WEBTOPS_CENSUS_FILES: list },
    timeoutMs: TIMEOUT_MS,
  });
  if (result.failure !== undefined || result.code !== 0) {
    const why =
      result.failure ??
      `exit ${String(result.code)}: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`;
    return { ok: false, message: `ESLint could not be asked about the project's files (${why})` };
  }
  return parseFacts(result.stdout);
}
