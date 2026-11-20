import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** A config file the reader looked in: its project-relative path and its text. */
export interface ConfigText {
  readonly file: string;
  readonly text: string;
}

/** A place in a config that does what the reader looks for: a file and a 1-based line. */
export interface Spot {
  readonly file: string;
  readonly line: number;
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** The values that put a rule below `error`: `off`, `warn`, `0`, `1`, `false` (a linter option), as a word or a number. */
const belowError = (): string => String.raw`(?:\[\s*)?(["']?)(?:off|warn|0|1|false)\1(?![\w.-])`;

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

/**
 * The lines of a config that set a rule to `off` or `warn` (or `0`, `1`), in any of the forms a flat config takes:
 * `"rule": "off"`, `rule: 0`, `"rule": ["warn", { ... }]`, with or without the plugin prefix. A rule is named by its
 * short name, so `no-explicit-any` finds `"@typescript-eslint/no-explicit-any": "off"`.
 */
export function loweringLines(text: string, rule: string): number[] {
  const short = rule.split("/").pop() ?? rule;
  const key = String.raw`(?<![\w@.-])["']?(?:[@\w.-]+/)*${escaped(short)}["']?\s*:\s*`;
  return [...text.matchAll(new RegExp(`${key}${belowError()}`, "gu"))].map((found) =>
    lineAt(text, found.index),
  );
}

/** A relative import, `export`, `require` or dynamic `import()` in a config: the other files it takes rules from. */
const relativeImport = (): RegExp => /(?:from|import\(|require\()\s*["'](\.{1,2}\/[^"']+)["']/gu;

const extensions = (): readonly string[] => ["", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"];

function resolved(cwd: string, from: string, specifier: string): string | undefined {
  const base = resolve(cwd, dirname(from), specifier);
  const found = extensions()
    .map((extension) => `${base}${extension}`)
    .find((path) => existsSync(path));
  return found === undefined ? undefined : found.slice(cwd.length + 1);
}

function readText(cwd: string, file: string): ConfigText | undefined {
  try {
    return { file, text: readFileSync(join(cwd, file), "utf8") };
  } catch {
    return undefined;
  }
}

/** The config file and the local files it imports (one level), as text; a file that cannot be read is left out. */
export function configTexts(cwd: string, config: string): ConfigText[] {
  const own = readText(cwd, config);
  if (own === undefined) {
    return [];
  }
  const imported = [...own.text.matchAll(relativeImport())].flatMap((found) => {
    const path = resolved(cwd, config, String(found[1]));
    const text = path === undefined ? undefined : readText(cwd, path);
    return text === undefined ? [] : [text];
  });
  return [own, ...imported];
}

/** Every place among the texts that lowers the rule. */
export const lowerings = (texts: readonly ConfigText[], rule: string): Spot[] =>
  texts.flatMap((config) =>
    loweringLines(config.text, rule).map((line) => ({ file: config.file, line })),
  );
