import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Runner } from "../census/eslint.ts";
import { parseRules, type RulesRead } from "./rules.ts";

/** How long the tool may take to answer: five minutes. */
const timeoutMs = (): number => 5 * 60 * 1000;

/** The config files Stylelint looks for in a project's root, besides a `stylelint` key of `package.json`. */
export function configNames(): readonly string[] {
  const extensions = ["json", "yaml", "yml", "js", "cjs", "mjs", "ts", "mts", "cts"];
  return [
    ".stylelintrc",
    ...extensions.map((ext) => `.stylelintrc.${ext}`),
    ...extensions.map((ext) => `stylelint.config.${ext}`),
  ];
}

/**
 * Run under Node from the checkout, so the Stylelint is the checkout's own. For each file it asks Stylelint to lint an
 * empty source under that file's name, which is how its ignore files and `ignoreFiles` decide whether it reaches the
 * file at all, and then `resolveConfig` for the file: every rule with its level (null or false is off, a `warning`
 * severity is 1, else 2) and its options as JSON. A file Stylelint ignores has no entry.
 */
function script(): string {
  return `
import { readFileSync } from "node:fs";
const stylelint = (await import("stylelint")).default;
const files = JSON.parse(readFileSync(process.env.WEBTOPS_LAWDIFF_FILES, "utf8"));
const cwd = process.cwd();
const levelOf = (value) => {
  const primary = Array.isArray(value) ? value[0] : value;
  if (primary === null || primary === false) return 0;
  const secondary = Array.isArray(value) ? value[1] : undefined;
  return secondary && secondary.severity === "warning" ? 1 : 2;
};
const optionsOf = (value) => {
  const plain = Array.isArray(value) ? value.length === 1 && value[0] === true : value === true;
  return plain || levelOf(value) === 0 ? "[]" : JSON.stringify(Array.isArray(value) ? value : [value]);
};
const rules = {};
for (const file of files) {
  const lint = await stylelint.lint({ code: "", codeFilename: file, cwd, allowEmptyInput: true });
  const hit = lint.results[0];
  if (!hit || hit.ignored) continue;
  const config = await stylelint.resolveConfig(file, { cwd });
  if (!config) continue;
  rules[file] = Object.fromEntries(Object.entries(config.rules ?? {}).map(([rule, value]) => [rule, { level: levelOf(value), options: optionsOf(value) }]));
}
process.stdout.write(JSON.stringify({ rules }));
`;
}

function problem(result: { code: number | null; stderr: string; failure?: string }): string {
  const why =
    result.failure ??
    `exit ${String(result.code)}: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`;
  return `Stylelint could not be asked about the project's files (${why})`;
}

/** Asks the checkout's Stylelint for the effective level and options of every rule of each CSS file, once. */
export async function askStyle(runner: Runner, files: readonly string[]): Promise<RulesRead> {
  const folder = join(runner.outDir, "lawdiff");
  mkdirSync(folder, { recursive: true });
  const list = join(folder, "stylelint-files.json");
  writeFileSync(list, JSON.stringify(files));
  const result = await runner.exec("node", ["--input-type=module", "-e", script()], {
    cwd: runner.cwd,
    env: { ...runner.env, WEBTOPS_LAWDIFF_FILES: list },
    timeoutMs: timeoutMs(),
  });
  if (result.failure !== undefined || result.code !== 0) {
    return { ok: false, message: problem(result) };
  }
  const value = parseRules(result.stdout);
  return value === undefined
    ? { ok: false, message: "Stylelint printed something that is not its rules" }
    : { ok: true, value };
}
