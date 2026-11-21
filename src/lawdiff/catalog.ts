import type { Law } from "../laws/catalog/index.ts";
import { compareRanked } from "./rank.ts";
import type { Item, LawFacts, Ranked } from "./types.ts";

export function factsOf(laws: readonly Law[]): Map<string, LawFacts> {
  return new Map(
    laws.map((law): [string, LawFacts] => [
      law.id,
      {
        severity: law.severity,
        judged: law.judged,
        classes: law.classes,
        rules: law.rules.map((rule) => `${rule.tool}: ${rule.name}`),
      },
    ]),
  );
}

const PRESENT: Ranked = { shown: "present", rank: 1 };

/**
 * TODO R106: a rule may carry `classes` (LawRule.classes, from the law data). Until that field is on main, a rule is
 * compared by tool and name only; with it, `rule <tool>: <name>` should also hold the classes the rule applies to.
 */
/** What a law holds, one named value each: a severity, whether it is judged, each class and each rule it maps. */
function heldBy(law: LawFacts): Map<string, Ranked> {
  const held = new Map<string, Ranked>([
    ["severity", { shown: law.severity, rank: law.severity === "R" ? 1 : 0 }],
    ["judged", { shown: law.judged, rank: law.judged === "no" ? 0 : 1 }],
  ]);
  law.classes.forEach((name) => held.set(`class ${name}`, PRESENT));
  law.rules.forEach((rule) => held.set(`rule ${rule}`, PRESENT));
  return held;
}

const lawItems = (id: string, base: LawFacts, head: LawFacts): Item[] =>
  compareRanked(heldBy(base), heldBy(head)).map((item) => ({
    ...item,
    what: `${id}: ${item.what}`,
  }));

/** The laws that moved: one that is gone or new is one item, and one in both is compared part by part. */
export function compareLaws(
  base: ReadonlyMap<string, LawFacts>,
  head: ReadonlyMap<string, LawFacts>,
): Item[] {
  const ids = [...new Set([...base.keys(), ...head.keys()])].sort();
  return ids.flatMap((id) => {
    const before = base.get(id);
    const after = head.get(id);
    if (before === undefined) {
      return [{ what: id, change: "strengthened" as const, before: "absent", after: "added" }];
    }
    return after === undefined
      ? [{ what: id, change: "weakened" as const, before: "present", after: "removed" }]
      : lawItems(id, before, after);
  });
}
