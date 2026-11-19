import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Linter } from "eslint";
import { eslintPreset } from "./eslint.js";
import type { EslintVariant } from "./eslint.js";

/** The kit's own root, which a scratch project links in as `node_modules/web-tops`. */
export const ROOT = resolve(import.meta.dirname, "../..");

const scratches: string[] = [];

/** Every scratch project made, so a test file can remove them afterwards. */
export function scratchDirs(): readonly string[] {
  return scratches;
}

/**
 * A project outside the kit that reaches it only as `node_modules/web-tops`, the way an inited
 * project does. `files` are written relative to the project; it is an ES module project.
 */
export function scratchProject(files: Readonly<Record<string, string>> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-preset-"));
  scratches.push(dir);
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(ROOT, join(dir, "node_modules", "web-tops"));
  const all = { "package.json": '{ "type": "module" }\n', ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/** The ESLint preset for a variant, as a project at `<project>` would get it. */
export function presetOf(variant: EslintVariant): Promise<Linter.Config[]> {
  return eslintPreset({ variant, tsconfigRootDir: "<project>" });
}

/** What a rule change shows in: each entry's scope, plugins by name, rules and parser options. */
function shape(entry: Linter.Config): object {
  return {
    files: entry.files,
    ignores: entry.ignores,
    plugins: Object.keys(entry.plugins ?? {}),
    rules: entry.rules,
    linterOptions: entry.linterOptions,
    parserOptions: entry.languageOptions?.parserOptions,
  };
}

/** The data of a flat config, ready to write as JSON and compare with a golden. */
export function plain(config: readonly Linter.Config[]): unknown {
  return JSON.parse(JSON.stringify(config.map(shape)));
}

const levelOf = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting);
const isError = (level: unknown): boolean => level === "error" || level === 2;

/** The rules a config sets to error. */
export function errorRules(config: readonly Linter.Config[]): ReadonlySet<string> {
  return new Set(
    config.flatMap((entry) =>
      Object.entries(entry.rules ?? {})
        .filter(([, setting]) => isError(levelOf(setting)))
        .map(([rule]) => rule),
    ),
  );
}

/** The plugin names a config registers. */
export function pluginNames(config: readonly Linter.Config[]): ReadonlySet<string> {
  return new Set(config.flatMap((entry) => Object.keys(entry.plugins ?? {})));
}
