import type { RawFinding } from "../report/findings.ts";
import { axeFindings } from "./axe.ts";
import { eslintIgnores, ruleOff } from "./config.ts";
import type { ConfigHit } from "./config.ts";
import { directivesIn, readsDirectives } from "./directives.ts";
import { eslintFacts, hasEslintConfig } from "./eslint.ts";
import type { Runner } from "./eslint.ts";
import { failed, passFinding } from "./finding.ts";
import { readSource, withinSource } from "./files.ts";
import { KIND_MESSAGES } from "./kinds.ts";
import { tsconfigHits } from "./tsconfig.ts";

export { AXE_KINDS, CENSUS_RULE_PREFIX, CONFIG_KINDS, SOURCE_KINDS } from "./kinds.ts";
export type { CensusKind } from "./kinds.ts";
export { directivesIn } from "./directives.ts";
export { eslintIgnores, ruleOff, tsconfigExcluded } from "./config.ts";

/** What the census reads: the project, its tracked files, and a way to run ESLint. */
export interface CensusInput extends Runner {
  readonly files: readonly string[];
}

const ESLINT_FILES = /\.(?:[cm]?[jt]sx?|astro)$/u;

/** A tracked file ESLint would be asked about: a script or Astro file outside the output and dependency folders. */
const isLintable = (file: string): boolean => ESLINT_FILES.test(file) && withinSource(file);

function directivesFor(cwd: string, file: string): RawFinding[] {
  const text = readSource(cwd, file);
  if (text === undefined) return [];
  return directivesIn(file, text).map((found) =>
    passFinding(found.kind, file, KIND_MESSAGES[found.kind], found.line),
  );
}

function directiveFindings(cwd: string, files: readonly string[]): RawFinding[] {
  return files
    .filter((file) => readsDirectives(file) && withinSource(file))
    .flatMap((file) => directivesFor(cwd, file));
}

const configFinding = (hit: ConfigHit): RawFinding =>
  passFinding(
    hit.kind,
    hit.file,
    hit.rule === undefined ? KIND_MESSAGES[hit.kind] : `${hit.rule}: ${KIND_MESSAGES[hit.kind]}`,
  );

/** `eslint-ignores` and `eslint-rule-off`, from the project's own ESLint, for the tracked files it would lint. */
async function eslintFindings(input: CensusInput): Promise<RawFinding[]> {
  const files = input.files.filter(isLintable);
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
 * `census/<kind>`, for each directive comment, ignored file, per-file rule-off, excluded file and axe setting. The baseline
 * counts them by kind (`censusKindOf`); the coverage hints are the coverage layer's. The axe kinds are the strings
 * of `.disableRules(...)` and `.exclude(...)` on an AxeBuilder. A config that ESLint or TypeScript cannot read, and
 * an axe argument that is not a literal, are failing findings, never a zero.
 */
export async function censusFindings(input: CensusInput): Promise<RawFinding[]> {
  return [
    ...directiveFindings(input.cwd, input.files),
    ...(await eslintFindings(input)),
    ...tsconfigFindings(input),
    ...axeFindings(input.cwd, input.files),
  ];
}
