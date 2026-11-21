import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Runner } from "../census/eslint.ts";
import type { RuleSetting, Rules } from "./types.ts";

/** How long ESLint may take to answer about every file: five minutes. */
const timeoutMs = (): number => 5 * 60 * 1000;

/**
 * Run under Node from the checkout, so the ESLint is the checkout's own and its config loads as `eslint` loads it. For
 * each file it prints, for every rule, the effective level and the options as JSON: what `eslint --print-config <file>`
 * says, for every file in one process. A file ESLint ignores, or that no config block reaches, has no entry.
 */
function script(): string {
  return `
import { readFileSync } from "node:fs";
const { ESLint } = await import("eslint");
const files = JSON.parse(readFileSync(process.env.WEBTOPS_LAWDIFF_FILES, "utf8"));
const eslint = new ESLint({ cwd: process.cwd() });
const NAMED = { off: 0, warn: 1, error: 2 };
const levelOf = (value) => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "number" ? first : (NAMED[first] ?? 0);
};
const optionsOf = (value) => JSON.stringify(Array.isArray(value) ? value.slice(1) : []);
const rules = {};
for (const file of files) {
  if (await eslint.isPathIgnored(file)) continue;
  const config = await eslint.calculateConfigForFile(file);
  if (!config) continue;
  rules[file] = Object.fromEntries(Object.entries(config.rules ?? {}).map(([rule, value]) => [rule, { level: levelOf(value), options: optionsOf(value) }]));
}
process.stdout.write(JSON.stringify({ rules }));
`;
}

export type RulesRead =
  { readonly ok: true; readonly value: Rules } | { readonly ok: false; readonly message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function settingOf(value: unknown): RuleSetting | undefined {
  if (!isRecord(value)) return undefined;
  const { level, options } = value;
  return typeof level === "number" && typeof options === "string" ? { level, options } : undefined;
}

function fileOf(value: unknown): ReadonlyMap<string, RuleSetting> | undefined {
  if (!isRecord(value)) return undefined;
  const settings = new Map<string, RuleSetting>();
  for (const [rule, found] of Object.entries(value)) {
    const setting = settingOf(found);
    if (setting === undefined) return undefined;
    settings.set(rule, setting);
  }
  return settings;
}

const entryOf = ([file, value]: [string, unknown]): readonly [
  string,
  ReadonlyMap<string, RuleSetting> | undefined,
] => [file, fileOf(value)];

function filesOf(found: Record<string, unknown>): Rules | undefined {
  const files = Object.entries(found).map(entryOf);
  const whole = new Map<string, ReadonlyMap<string, RuleSetting>>();
  for (const [file, rules] of files) {
    if (rules === undefined) return undefined;
    whole.set(file, rules);
  }
  return whole;
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The rules ESLint printed, or undefined when what it printed is not that. */
export function parseRules(text: string): Rules | undefined {
  const doc = json(text);
  const found = isRecord(doc) ? doc["rules"] : undefined;
  return isRecord(found) ? filesOf(found) : undefined;
}

/** Why a process did not answer: a spawn that failed is said with where it was started, so the folder can be looked at. */
function whyNot(
  result: { code: number | null; stderr: string; failure?: string },
  cwd: string,
): string {
  if (result.failure === "tool-missing") {
    const there = existsSync(cwd) ? "the folder is there" : "the folder is missing";
    return `tool-missing: node could not be started in ${cwd}, ${there}`;
  }
  return (
    result.failure ??
    `exit ${String(result.code)}: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`
  );
}

const problem = (
  result: { code: number | null; stderr: string; failure?: string },
  cwd: string,
): string => `ESLint could not be asked about the project's files (${whyNot(result, cwd)})`;

/** Asks the checkout's ESLint for the effective level and options of every rule of each file, once. */
export async function askRules(runner: Runner, files: readonly string[]): Promise<RulesRead> {
  const folder = join(runner.outDir, "lawdiff");
  mkdirSync(folder, { recursive: true });
  const list = join(folder, "eslint-files.json");
  writeFileSync(list, JSON.stringify(files));
  const result = await runner.exec("node", ["--input-type=module", "-e", script()], {
    cwd: runner.cwd,
    env: { ...runner.env, WEBTOPS_LAWDIFF_FILES: list },
    timeoutMs: timeoutMs(),
  });
  if (result.failure !== undefined || result.code !== 0)
    return { ok: false, message: problem(result, runner.cwd) };
  const value = parseRules(result.stdout);
  return value === undefined
    ? { ok: false, message: "ESLint printed something that is not its rules" }
    : { ok: true, value };
}
