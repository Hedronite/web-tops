/** The census kinds read from comments in source files. The coverage hints (v8, istanbul, c8) are the coverage layer's. */
export const SOURCE_KINDS = [
  "eslint-disable",
  "ts-expect-error",
  "ts-ignore",
  "ts-nocheck",
  "stylelint-disable",
  "biome-ignore",
  "stryker-disable",
  "html-validate-disable",
] as const;

/** The census kinds read from the project's configuration against the tracked files. */
export const CONFIG_KINDS = ["eslint-rule-off", "eslint-ignores", "tsconfig-exclude"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];
export type ConfigKind = (typeof CONFIG_KINDS)[number];
export type CensusKind = SourceKind | ConfigKind;

/** The finding rule that stands for a census kind in a report: `census/<kind>` (read back by the baseline). */
export const CENSUS_RULE_PREFIX = "census/";

/** What a census finding says about each kind. */
export const KIND_MESSAGES: Readonly<Record<CensusKind, string>> = {
  "eslint-disable": "an ESLint directive comment turns lint rules off here",
  "ts-expect-error": "a @ts-expect-error directive silences a type error here",
  "ts-ignore": "a @ts-ignore directive silences a type error here",
  "ts-nocheck": "a @ts-nocheck directive switches type checking off for the file",
  "stylelint-disable": "a stylelint directive comment turns style rules off here",
  "biome-ignore": "a biome-ignore comment turns a Biome rule off here",
  "stryker-disable": "a Stryker disable comment keeps mutants from being judged here",
  "html-validate-disable": "an html-validate directive turns a markup rule off here",
  "eslint-rule-off": "a per-file ESLint setting turns a rule off for this file",
  "eslint-ignores": "an ESLint ignores entry leaves this file out of linting",
  "tsconfig-exclude": "the tsconfig exclude leaves this file out of the program",
};
