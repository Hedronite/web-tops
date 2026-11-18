import type { ConfigKind } from "./kinds.ts";

/** One census item read from configuration: a tracked file, and for a rule that is switched off, the rule. */
export interface ConfigHit {
  readonly kind: ConfigKind;
  readonly file: string;
  readonly rule?: string;
}

/** ESLint's effective level of each rule for each file: 0 off, 1 warn, 2 error (from `calculateConfigForFile`). */
export type Levels = ReadonlyMap<string, ReadonlyMap<string, number>>;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byFile = (a: ConfigHit, b: ConfigHit): number =>
  compare(a.file, b.file) || compare(a.rule ?? "", b.rule ?? "");

/**
 * `eslint-ignores`: each tracked file in scope that an ESLint `ignores` entry leaves out, from ESLint's own
 * `isPathIgnored` for the file (WEB_TOPS.md section 6.7).
 */
export function eslintIgnores(ignored: ReadonlyMap<string, boolean>): ConfigHit[] {
  return [...ignored]
    .filter(([, left]) => left)
    .map(([file]): ConfigHit => ({ kind: "eslint-ignores", file }))
    .sort(byFile);
}

interface Tally {
  on: number;
  readonly off: string[];
}

function tally(rules: Map<string, Tally>, rule: string, file: string, level: number): void {
  const found = rules.get(rule) ?? { on: 0, off: [] };
  rules.set(rule, found);
  if (level > 0) found.on += 1;
  else found.off.push(file);
}

/**
 * `eslint-rule-off`: each (rule, tracked file) pair whose effective level is off while the rule is on for another
 * tracked file: a per-file override that sets a rule off. A rule that is off everywhere is not counted here: for
 * a required law that is `refuse` (WEB_TOPS.md section 8.1).
 */
export function ruleOff(levels: Levels): ConfigHit[] {
  const rules = new Map<string, Tally>();
  for (const [file, byRule] of levels) {
    for (const [rule, level] of byRule) tally(rules, rule, file, level);
  }
  return [...rules]
    .filter(([, found]) => found.on > 0)
    .flatMap(([rule, found]) =>
      found.off.map((file): ConfigHit => ({ kind: "eslint-rule-off", file, rule })),
    )
    .sort(byFile);
}

/**
 * `tsconfig-exclude`: each tracked file in scope (selected by `include`, before `exclude`) that the program does
 * not hold. A file `exclude` names that an included file imports is in the program, and is not counted.
 */
export function tsconfigExcluded(
  candidates: readonly string[],
  program: ReadonlySet<string>,
): ConfigHit[] {
  return candidates
    .filter((file) => !program.has(file))
    .map((file): ConfigHit => ({ kind: "tsconfig-exclude", file }))
    .sort(byFile);
}
