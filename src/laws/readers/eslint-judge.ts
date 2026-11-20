import { extname } from "node:path";
import type { Levels } from "../../census/config.ts";
import type { RawFinding } from "../../report/findings.ts";
import type { LawEntry, LawReading } from "./types.ts";
import { lowerings, type ConfigText, type Spot } from "./config-lines.ts";

/** What the ESLint reader knows: each TypeScript file's effective levels, the config's text, and what ESLint reported. */
export interface Evidence {
  readonly levels: Levels;
  /** ESLint's findings from gate 1, counted by rule id. */
  readonly counts: ReadonlyMap<string, number>;
  readonly config: readonly ConfigText[];
  /** The ESLint config file, where a rule that no line lowers is said to be missing. */
  readonly configFile: string;
  /** The ratchet holds finding counts: they are the ratchet's to refuse (section 6.7). */
  readonly held: boolean;
}

function typescript(): ReadonlySet<string> {
  return new Set([".ts", ".tsx", ".mts", ".cts"]);
}

/** The files a typed rule is judged over: a rule that is off for `.js` by design is not a lapse. */
export const isTypeScript = (file: string): boolean =>
  typescript().has(extname(file).toLowerCase());

/** A rule id is the name, or the name under a plugin prefix. */
export const matches = (id: string, name: string): boolean =>
  id === name || id.endsWith(`/${name}`);

/** The highest level among the rules of a file that the name matches, or undefined when the file never sets it. */
function levelFor(byRule: ReadonlyMap<string, number>, name: string): number | undefined {
  const found = [...byRule].filter(([id]) => matches(id, name)).map(([, level]) => level);
  return found.length === 0 ? undefined : Math.max(...found);
}

interface Seen {
  readonly file: string;
  readonly level: number | undefined;
}

const isLowered = (seen: Seen): boolean => seen.level !== undefined && seen.level < 2;
const isError = (seen: Seen): boolean => seen.level === 2;
const fileOf = (seen: Seen): string => seen.file;

/** How a rule stands across the TypeScript files: the files that set it below error, and how many set it to error. */
interface Spread {
  readonly below: readonly string[];
  readonly on: number;
}

function spread(levels: Levels, name: string): Spread {
  const files = [...levels].filter(([file]) => isTypeScript(file));
  const seen = files.map(([file, byRule]): Seen => ({ file, level: levelFor(byRule, name) }));
  return { below: seen.filter(isLowered).map(fileOf), on: seen.filter(isError).length };
}

/** What one rule or flag of a law comes to. */
interface RuleCheck {
  readonly verdict: "pass" | "refuse";
  readonly findings: readonly RawFinding[];
}

function pass(): RuleCheck {
  return { verdict: "pass", findings: [] };
}

/** The id a rule has in the effective config (`@typescript-eslint/no-explicit-any` for `no-explicit-any`). */
function idOf(levels: Levels, name: string): string {
  const ids = [...levels.values()].flatMap((byRule) => [...byRule.keys()]);
  return ids.find((id) => matches(id, name)) ?? name;
}

const refusal = (law: string, id: string, spot: Spot, message: string): RawFinding => ({
  tool: "eslint",
  rule: id,
  law,
  verdict: "refuse",
  message,
  file: spot.file,
  line: spot.line,
});

/** The lines that lower the rule, or the top of the config when no line does: it is set by a config the file imports. */
function spotsOf(evidence: Evidence, name: string): Spot[] {
  const lines = lowerings(evidence.config, name);
  return lines.length > 0 ? lines : [{ file: evidence.configFile, line: 1 }];
}

/** A rule an override sets below `error` for some files: `refuse`, at each config line that does it (X3). */
function lapsed(
  evidence: Evidence,
  law: string,
  name: string,
  found: Spread,
): RuleCheck | undefined {
  if (found.below.length === 0) {
    return undefined;
  }
  const id = idOf(evidence.levels, name);
  const message = `${id} is below error for ${String(found.below.length)} file(s), such as ${String(found.below[0])}`;
  const findings = spotsOf(evidence, name).map((spot) => refusal(law, id, spot, message));
  return { verdict: "refuse", findings };
}

/** A rule no TypeScript file has at error: it is not enabled at all. */
function neverOn(
  evidence: Evidence,
  law: string,
  name: string,
  found: Spread,
): RuleCheck | undefined {
  if (found.on > 0) {
    return undefined;
  }
  const spot = { file: evidence.configFile, line: 1 };
  const message = `${name} is not enabled for any TypeScript file`;
  return {
    verdict: "refuse",
    findings: [refusal(law, idOf(evidence.levels, name), spot, message)],
  };
}

function checkRule(evidence: Evidence, law: string, name: string): RuleCheck {
  const found = spread(evidence.levels, name);
  return lapsed(evidence, law, name, found) ?? neverOn(evidence, law, name, found) ?? pass();
}

/** The findings of gate 1 for a rule name, summed over its ids. */
function countFor(counts: ReadonlyMap<string, number>, name: string): number {
  return [...counts]
    .filter(([id]) => matches(id, name))
    .reduce((total, [, count]) => total + count, 0);
}

const tally = (counts: ReadonlyMap<string, number>, names: readonly string[]): string[] =>
  names.flatMap((name) => {
    const count = countFor(counts, name);
    return count === 0 ? [] : [`${name} ${String(count)}`];
  });

const isEslintRule = (rule: { readonly tool: string }): boolean => rule.tool === "eslint";

const refused = (check: RuleCheck): boolean => check.verdict === "refuse";

function refusedReading(law: string, checks: readonly RuleCheck[]): LawReading | undefined {
  return checks.some(refused)
    ? { law, verdict: "refuse", findings: checks.flatMap((check) => check.findings) }
    : undefined;
}

/** Findings of gate 1 on the law's rules: `refuse`, unless the ratchet holds them. */
function countedReading(
  law: string,
  counted: readonly string[],
  held: boolean,
): LawReading | undefined {
  return counted.length > 0 && !held
    ? { law, verdict: "refuse", findings: [], note: counted.join(", ") }
    : undefined;
}

/** Why no rule can be judged, worded for an adopter whose ESLint config cannot reach `.ts` files at all. */
function unlintedReason(): string {
  return "no TypeScript file was linted: ESLint's config reaches no TypeScript file (no config block has files for **/*.ts and the TypeScript parser, or an ignore drops them), so no rule can be judged";
}

/** No TypeScript file was linted: the typed rules have no file to be judged over. */
function unjudgedReading(law: string, evidence: Evidence): LawReading | undefined {
  return [...evidence.levels.keys()].some(isTypeScript)
    ? undefined
    : { law, verdict: "not-evaluated", reason: unlintedReason(), findings: [] };
}

function passReading(law: string, counted: readonly string[]): LawReading {
  const note = counted.length === 0 ? undefined : `${counted.join(", ")} held by the baseline`;
  return { law, verdict: "pass", findings: [], ...(note === undefined ? {} : { note }) };
}

/**
 * The law's reading over its ESLint rules: a rule below error is `refuse` at the config line that does it (X3), a
 * finding of gate 1 on one of its rules is `refuse`, and a rule no TypeScript file could be judged by is not evaluated.
 */
export function readLaw(evidence: Evidence, law: LawEntry): LawReading {
  const names = law.rules.filter(isEslintRule).map((rule) => rule.name);
  const checks = names.map((name) => checkRule(evidence, law.id, name));
  const counted = tally(evidence.counts, names);
  return (
    unjudgedReading(law.id, evidence) ??
    refusedReading(law.id, checks) ??
    countedReading(law.id, counted, evidence.held) ??
    passReading(law.id, counted)
  );
}
