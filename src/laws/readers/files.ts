import { extname } from "node:path";
import { withinSource } from "../../census/files.ts";
import type { EslintFacts } from "../../census/eslint.ts";
import type { RawFinding } from "../../report/findings.ts";

function sourceFile(): RegExp {
  return /\.[cm]?tsx?$/u;
}

/** The tracked TypeScript source the compiler and the lint laws judge: outside the output and dependency folders. */
export const trackedSource = (tracked: readonly string[]): string[] =>
  tracked.filter((file) => sourceFile().test(file) && withinSource(file));

/** The files ESLint reads for the lint laws: TypeScript, and the Astro pages and components. */
function lintedExtensions(): readonly string[] {
  return [".ts", ".tsx", ".mts", ".cts", ".astro"];
}

/** The tracked source ESLint judges: TypeScript and `.astro`, outside the output and dependency folders. */
export const trackedLinted = (tracked: readonly string[]): string[] =>
  tracked.filter(
    (file) => lintedExtensions().includes(extname(file).toLowerCase()) && withinSource(file),
  );

/** Where a path ESLint is asked about, though no file is there, begins: the project's own `src/`. */
const probeBase = (): string => "src/__webtops_probe__";

/** Whether a path is one ESLint was asked about in place of a file the project does not have. */
export const isProbe = (file: string): boolean => file.startsWith(probeBase());

/**
 * One path for each linted file type the project has no file of. A rule that only a type the project lacks carries
 * is judged over the path ESLint's config gives it: ESLint says what config reaches a path without reading it.
 */
export function probePaths(files: readonly string[]): string[] {
  const have = new Set(files.map((file) => extname(file).toLowerCase()));
  return lintedExtensions()
    .filter((extension) => !have.has(extension))
    .map((extension) => `${probeBase()}${extension}`);
}

/** What ESLint is asked about: the tracked files it judges, and a probe path for each type the project has none of. */
export const askedOf = (linted: readonly string[]): string[] => [...linted, ...probePaths(linted)];

/** Whether a file is one of the types ESLint judges the lint laws over. */
export const isLinted = (file: string): boolean =>
  lintedExtensions().includes(extname(file).toLowerCase());

/**
 * The data trees of section 17: test data and probes break rules on purpose and are never source the tools judge. The
 * list is fixed here and in the text; no ESLint `ignores` entry and no tsconfig `exclude` adds to it, because one line
 * would hide a file from a tool.
 */
function dataTrees(): readonly string[] {
  return ["fixtures/", "probes/"];
}

export const isData = (file: string): boolean => dataTrees().some((tree) => file.startsWith(tree));

/** Why ESLint judges no law over a file: an `ignores` entry drops it, or no config block reaches it. */
const why = (ignored: boolean): string =>
  ignored ? "an ESLint ignore drops it" : "no ESLint config block reaches it";

/**
 * File-set completeness for ESLint: a tracked source file outside the data trees that an ignore drops, or that no
 * config block reaches, is linted by nothing, so no lint law judges it.
 */
export function unlinted(source: readonly string[], facts: EslintFacts): RawFinding[] {
  return source
    .filter((file) => !isData(file))
    .filter((file) => facts.ignored.get(file) === true || !facts.levels.has(file))
    .map((file) => ({
      tool: "eslint",
      rule: "file-set",
      verdict: "refuse",
      message: `${file} is not linted: ${why(facts.ignored.get(file) === true)}, so no lint law judges it`,
      file,
    }));
}
