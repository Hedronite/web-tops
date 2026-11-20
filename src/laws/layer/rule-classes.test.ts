import { describe, expect, it } from "vitest";
import type { Law } from "../catalog/index.ts";
import type { LawEntry } from "../readers/types.ts";
import { entryOf } from "./catalog.ts";
import { forClass, ruleApplies } from "./entries.ts";

/** R106: a rule with a class list holds for those classes only, and is neither required nor refused for another. */

const PLAIN = "jsx-a11y-x/alt-text";
const ASTRO = "astro/jsx-a11y/alt-text";

const W22: LawEntry = {
  id: "W-22",
  severity: "R",
  reader: "tl",
  classes: ["ui-components", "astro-site"],
  judged: true,
  rules: [
    { tool: "eslint", name: PLAIN },
    { tool: "eslint", name: ASTRO, classes: ["astro-site"] },
  ],
};

describe("a rule and the class it holds for", () => {
  it("holds for every class when it names none, and only for the named ones when it does", () => {
    const open = { tool: "eslint", name: "a" };
    const shut = { tool: "eslint", name: "b", classes: ["astro-site"] };
    expect([ruleApplies(open, "node-service"), ruleApplies(shut, "node-service")]).toEqual([
      true,
      false,
    ]);
    expect(ruleApplies(shut, "astro-site")).toBe(true);
    expect(ruleApplies({ ...shut, classes: [] }, "astro-site")).toBe(false);
  });

  it("a law as a class reads it keeps its other fields and only the rules that hold", () => {
    const read = forClass(W22, "ui-components");
    expect(read.rules.map((rule) => rule.name)).toEqual([PLAIN]);
    expect(read).toMatchObject({
      id: "W-22",
      severity: "R",
      classes: ["ui-components", "astro-site"],
    });
    expect(forClass(W22, "astro-site").rules.map((rule) => rule.name)).toEqual([PLAIN, ASTRO]);
  });
});

describe("the catalog's rule classes reach the layer", () => {
  it("entryOf keeps each rule's classes, as the catalog's schema has them", () => {
    const law: Law = {
      id: "W-22",
      title: "t",
      family: "HTML and accessibility",
      severity: "R",
      classes: ["ui-components", "astro-site"],
      reader: { kinds: ["tl"], text: "tl" },
      rules: [
        { tool: "eslint", name: PLAIN },
        { tool: "eslint", name: ASTRO, classes: ["astro-site"] },
      ],
      judged: "v0.1",
      rationale: "r",
      fix: "f",
    };
    expect(entryOf(law).rules).toEqual([
      { tool: "eslint", name: PLAIN },
      { tool: "eslint", name: ASTRO, classes: ["astro-site"] },
    ]);
  });
});
