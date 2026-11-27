import type { LawEntry, LawRule } from "../../laws/readers/types.ts";

/** The laws a class maps: a law with no class list is mapped by every class (section 5.2). */
export const lawsOfClass = <Entry extends LawEntry>(
  laws: readonly Entry[],
  className: string,
): Entry[] => laws.filter((law) => law.classes.length === 0 || law.classes.includes(className));

/** An entry, and those of its classes that map the law only for a project that depends on Astro (section 5.2). */
export type ClassedLaw = LawEntry & { readonly conditional?: readonly string[] };

/**
 * The laws a class maps in this project. A conditional class (W-27 for `web-app` and `ui-components`) maps its law
 * only when the project depends on Astro (section 5.2): for any other project the law is not there at all.
 */
export const lawsOfProject = (
  laws: readonly ClassedLaw[],
  className: string,
  dependsOnAstro: boolean,
): ClassedLaw[] =>
  lawsOfClass(laws, className).filter(
    (law) => dependsOnAstro || law.conditional?.includes(className) !== true,
  );

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
