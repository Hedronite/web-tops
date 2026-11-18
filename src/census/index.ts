import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawFinding } from "../report/findings.ts";
import { eslintIgnores, ruleOff } from "./config.ts";
import type { ConfigHit } from "./config.ts";
import { directivesIn, readsDirectives } from "./directives.ts";
import { eslintFacts, hasEslintConfig } from "./eslint.ts";
import type { Runner } from "./eslint.ts";
import { CENSUS_RULE_PREFIX, KIND_MESSAGES } from "./kinds.ts";
import type { CensusKind } from "./kinds.ts";
import { tsconfigHits } from "./tsconfig.ts";

export { CENSUS_RULE_PREFIX, CONFIG_KINDS, SOURCE_KINDS } from "./kinds.ts";
export type { CensusKind } from "./kinds.ts";
export { directivesIn } from "./directives.ts";
export { eslintIgnores, ruleOff, tsconfigExcluded } from "./config.ts";

/** What the census reads: the project, its tracked files, and a way to run ESLint. */
export interface CensusInput extends Runner {
  readonly files: readonly string[];
}

/** Output and dependency folders hold no source of the project's own, at any depth. */
const OUTPUT = /(?:^|\/)(?:node_modules|dist|coverage|\.web-tops|\.astro)\//u;

const ESLINT_FILES = /\.(?:[cm]?[jt]sx?|astro)$/u;

const passFinding = (
  kind: CensusKind,
  file: string,
  message: string,
  line?: number,
): RawFinding => ({
  tool: "webtops",
  rule: `${CENSUS_RULE_PREFIX}${kind}`,
  verdict: "pass",
  message,
  file,
  ...(line === undefined ? {} : { line }),
});

/** A tracked file's text, or undefined when it is not there to read (deleted in the working tree, a submodule). */
function textOf(cwd: string, file: string): string | undefined {
  try {
    return readFileSync(join(cwd, file), "utf8");
  } catch {
    return undefined;
  }
}

function directivesFor(cwd: string, file: string): RawFinding[] {
  const text = textOf(cwd, file);
  if (text === undefined) return [];
  return directivesIn(file, text).map((found) =>
    passFinding(found.kind, file, KIND_MESSAGES[found.kind], found.line),
  );
}

function directiveFindings(cwd: string, files: readonly string[]): RawFinding[] {
  return files
    .filter((file) => readsDirectives(file) && !OUTPUT.test(file))
    .flatMap((file) => directivesFor(cwd, file));
}

const configFinding = (hit: ConfigHit): RawFinding =>
  passFinding(
    hit.kind,
    hit.file,
    hit.rule === undefined ? KIND_MESSAGES[hit.kind] : `${hit.rule}: ${KIND_MESSAGES[hit.kind]}`,
  );

const failed = (rule: string, message: string): RawFinding => ({
  tool: "webtops",
  rule,
  verdict: "fail",
  message,
});

/** `eslint-ignores` and `eslint-rule-off`, from the project's own ESLint, for the tracked files it would lint. */
async function eslintFindings(input: CensusInput): Promise<RawFinding[]> {
  const files = input.files.filter((file) => ESLINT_FILES.test(file) && !OUTPUT.test(file));
  if (!hasEslintConfig(input.cwd) || files.length === 0) return [];
  const read = await eslintFacts(input, files);
  if (!read.ok) return [failed("census-eslint-unreadable", read.message)];
  return [...eslintIgnores(read.facts.ignored), ...ruleOff(read.facts.levels)].map(configFinding);
}

function tsconfigFindings(input: CensusInput): RawFinding[] {
  const read = tsconfigHits(input.cwd, new Set(input.files));
  return read.ok
    ? read.hits.map(configFinding)
    : [failed("census-tsconfig-unreadable", read.message)];
}

/**
 * The suppression census of a project (WEB_TOPS.md section 6.7), as findings: one pass finding, rule
 * `census/<kind>`, for each directive comment, ignored file, per-file rule-off and excluded file. The baseline
 * counts them by kind (`censusKindOf`); the coverage hints and the axe kinds are not read here. A config that
 * ESLint or TypeScript cannot read is a failing finding, never a zero.
 */
export async function censusFindings(input: CensusInput): Promise<RawFinding[]> {
  return [
    ...directiveFindings(input.cwd, input.files),
    ...(await eslintFindings(input)),
    ...tsconfigFindings(input),
  ];
}
