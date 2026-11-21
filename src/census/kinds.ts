/** The census kinds read from comments in source files, and from the ack ledger for the last. The coverage hints (v8, istanbul, c8) are the coverage layer's. */
export const SOURCE_KINDS = [
  "eslint-disable",
  "ts-expect-error",
  "ts-ignore",
  "ts-nocheck",
  "stylelint-disable",
  "biome-ignore",
  "stryker-disable",
  "html-validate-disable",
  "webtops-ack",
] as const;

/** The census kinds read from the project's configuration against the tracked files. */
export const CONFIG_KINDS = ["eslint-rule-off", "eslint-ignores", "tsconfig-exclude"] as const;

/** The census kinds read from the syntax of the project's source: the settings of an axe run. */
export const AXE_KINDS = ["axe-disable-rules", "axe-exclude"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];
/** The kind of an acknowledgement of a soft law: `// webtops-ack W-NN: reason` comments and the entries of the ack ledger (WEB_TOPS.md section 8.1). */
export type AckKind = Extract<SourceKind, "webtops-ack">;
export type ConfigKind = (typeof CONFIG_KINDS)[number];
export type AxeKind = (typeof AXE_KINDS)[number];
export type CensusKind = SourceKind | ConfigKind | AxeKind;

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
  "axe-disable-rules": "an axe run switches a rule off",
  "axe-exclude": "an axe run leaves a selector out of the page it checks",
  "eslint-rule-off": "a per-file ESLint setting turns a rule off for this file",
  "eslint-ignores": "an ESLint ignores entry leaves this file out of linting",
  "tsconfig-exclude": "the tsconfig exclude leaves this file out of the program",
  "webtops-ack": "an acknowledgement records a broken soft law as accepted here",
};
