import { withinSource } from "../../census/files.ts";
import type { EslintFacts } from "../../census/eslint.ts";
import type { RawFinding } from "../../report/findings.ts";

function sourceFile(): RegExp {
  return /\.[cm]?tsx?$/u;
}

/** The tracked TypeScript source the compiler and the lint laws judge: outside the output and dependency folders. */
export const trackedSource = (tracked: readonly string[]): string[] =>
  tracked.filter((file) => sourceFile().test(file) && withinSource(file));

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
