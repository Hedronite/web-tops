import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFacts, type EslintRead, type Runner } from "../../census/eslint.ts";

/** The linter option the reader judges beside the rules: W-35 needs unused directives at `error`. */
export const UNUSED_DIRECTIVES = "reportUnusedDisableDirectives";

const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run under Node from the project, so the ESLint is the project's own and the config loads as `eslint` loads it. For
 * each file it prints whether ESLint ignores it and the effective level of every rule, with the `linterOptions` level
 * of unused directives among them: what `eslint --print-config <file>` says, for every file in one process. A rule the
 * file's config never sets is absent, and a rule an override sets to `off` is present at 0.
 */
function script(): string {
  return `
import { readFileSync } from "node:fs";
const { ESLint } = await import("eslint");
const files = JSON.parse(readFileSync(process.env.WEBTOPS_LAWS_FILES, "utf8"));
const eslint = new ESLint({ cwd: process.cwd() });
const NAMED = { off: 0, warn: 1, error: 2 };
// A probe path or a page's script block is not a file: a config that cannot answer for one reaches none.
const VIRTUAL = /__webtops_probe__|\\.astro\\/\\d+\\.(?:ts|js)$/u;
const levelOf = (value) => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "number" ? first : (NAMED[first] ?? 0);
};
// A page's script block has no type information, so a rule that needs it cannot run there: it says nothing about
// that path. Every other rule is judged there as anywhere.
const SCRIPT = /\\.astro\\/\\d+\\.(?:ts|js)$/u;
const typed = (config, rule) => {
  const cut = rule.lastIndexOf("/");
  const found = config.plugins?.[rule.slice(0, cut)]?.rules?.[rule.slice(cut + 1)];
  return found?.meta?.docs?.requiresTypeChecking === true;
};
const heard = (config, file) =>
  Object.entries(config.rules ?? {}).filter(([rule]) => !(SCRIPT.test(file) && typed(config, rule)));
const ignored = {};
const levels = {};
const read = async (file) => {
  ignored[file] = await eslint.isPathIgnored(file);
  if (ignored[file]) return;
  const config = await eslint.calculateConfigForFile(file);
  if (!config) return;
  const rules = Object.fromEntries(heard(config, file).map(([rule, value]) => [rule, levelOf(value)]));
  const unused = config.linterOptions?.${UNUSED_DIRECTIVES};
  levels[file] = { ...rules, ${UNUSED_DIRECTIVES}: unused === undefined ? 0 : levelOf(unused) };
};
for (const file of files) {
  try {
    await read(file);
  } catch (error) {
    if (!VIRTUAL.test(file)) throw error;
    delete ignored[file];
  }
}
process.stdout.write(JSON.stringify({ ignored, levels }));
`;
}

function problem(result: { code: number | null; stderr: string; failure?: string }): string {
  const why =
    result.failure ??
    `exit ${String(result.code)}: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`;
  return `ESLint could not be asked about the project's files (${why})`;
}

/**
 * Asks the project's ESLint for the effective configuration of each file, once. A config that does not load, or an
 * ESLint that is not installed, is the answer `ok: false`.
 */
export async function askEslint(runner: Runner, files: readonly string[]): Promise<EslintRead> {
  const folder = join(runner.outDir, "laws");
  mkdirSync(folder, { recursive: true });
  const list = join(folder, "eslint-files.json");
  writeFileSync(list, JSON.stringify(files));
  const result = await runner.exec("node", ["--input-type=module", "-e", script()], {
    cwd: runner.cwd,
    env: { ...runner.env, WEBTOPS_LAWS_FILES: list },
    timeoutMs: TIMEOUT_MS,
  });
  const failed = result.failure !== undefined || result.code !== 0;
  return failed ? { ok: false, message: problem(result) } : parseFacts(result.stdout);
}
