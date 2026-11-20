import type { LawSource, ProbeLaw } from "./types.ts";

/** What the probe reads of a law in `laws/W-NN.yaml` (`schema/law.schema.json`): the catalog's `Law` has all of it. */
export interface LawRecord {
  readonly id: string;
  readonly classes: readonly string[];
  readonly judged: string;
  readonly rules: readonly { readonly tool: string; readonly name: string }[];
}

/** The tools whose rules a twin can fire: a lint config, the compiler's flags, and Stylelint. */
function probedTools(): readonly string[] {
  return ["eslint", "tsc", "stylelint"];
}

/**
 * The rules of the custom plugin (`webtops/…`) are proven in its own package with ESLint's `RuleTester`, and by the
 * twins of the step that lands the plugin, not by the probe's own twins.
 */
const isCustom = (name: string): boolean => name.startsWith("webtops/");

const probed = (rule: LawRecord["rules"][number]): boolean => probedTools().includes(rule.tool);

/** A law is judged when section 8.2 ticks it (`v0.1`) or milestone M3 gives it a reader (`m3`); `no` is not judged yet. */
const isJudged = (law: LawRecord): boolean => law.judged === "v0.1" || law.judged === "m3";

/**
 * Whether the probe proves a law: it is judged, a lint rule or a compiler flag judges it, and none of those is a rule
 * of the custom plugin.
 */
export function isProbed(law: LawRecord): boolean {
  const rules = law.rules.filter(probed);
  return isJudged(law) && rules.length > 0 && !rules.some((rule) => isCustom(rule.name));
}

/** A law as the probe takes it: what its tool rules and flags name are what its twins must prove. */
export const toProbeLaw = (law: LawRecord): ProbeLaw => ({
  id: law.id,
  classes: law.classes,
  proofs: law.rules.filter(probed).map((rule) => rule.name),
});

/** The probe's laws out of the catalog's records, in id order. */
export const probeLaws = (records: readonly LawRecord[]): ProbeLaw[] =>
  records
    .filter(isProbed)
    .map(toProbeLaw)
    .sort((a, b) => a.id.localeCompare(b.id));

/** The law source over a way to read the catalog's records. */
export const sourceOf =
  (read: () => readonly LawRecord[]): LawSource =>
  () =>
    probeLaws(read());
