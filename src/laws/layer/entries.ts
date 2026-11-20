import type { LawEntry, LawRule } from "../../laws/readers/types.ts";

/** The laws a class maps: a law with no class list is mapped by every class (section 5.2). */
export const lawsOfClass = (laws: readonly LawEntry[], className: string): LawEntry[] =>
  laws.filter((law) => law.classes.length === 0 || law.classes.includes(className));

/** A rule with no class list holds for every class its law maps; one with a list holds for those classes only. */
export const ruleApplies = (rule: LawRule, className: string): boolean =>
  rule.classes === undefined || rule.classes.includes(className);

/** The law as one class reads it: a rule outside the class is neither required nor refused. */
export const forClass = (law: LawEntry, className: string): LawEntry => ({
  ...law,
  rules: law.rules.filter((rule) => ruleApplies(rule, className)),
});

/**
 * A law is required when section 8.2 judges it and the class maps it (section 3.3). A mapped law that is not judged is
 * counted and printed, never failing the run.
 */
export const isRequired = (law: LawEntry, className: string): boolean =>
  law.judged && lawsOfClass([law], className).length > 0;

/** The tools a law maps rules of, in the order the law lists them, each once. */
export const toolsOf = (law: LawEntry): string[] => [
  ...new Set(law.rules.map((rule) => rule.tool)),
];
