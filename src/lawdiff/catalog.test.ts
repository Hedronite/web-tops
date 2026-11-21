import { describe, expect, it } from "vitest";
import type { Law } from "../laws/catalog/index.ts";
import { compareLaws, factsOf } from "./catalog.ts";
import type { LawFacts } from "./types.ts";

const law = (id: string, extra: Partial<Law> = {}): Law => ({
  id,
  title: "t",
  family: "Types",
  severity: "R",
  classes: ["ts-library", "node-service"],
  reader: { kinds: ["tl"], text: "x" },
  rules: [{ tool: "eslint", name: "no-explicit-any" }],
  judged: "v0.1",
  rationale: "r",
  fix: "f",
  ...extra,
});

const facts = (...laws: Law[]): ReadonlyMap<string, LawFacts> => factsOf(laws);

describe("a law as the diff holds it", () => {
  it("is its severity, whether it is judged, its classes and each rule by tool and name", () => {
    expect(facts(law("W-01")).get("W-01")).toEqual({
      severity: "R",
      judged: "v0.1",
      classes: ["ts-library", "node-service"],
      rules: ["eslint: no-explicit-any"],
    });
  });
});

describe("the laws that moved", () => {
  it("says a law that is gone is weaker and one that is new is stronger, once each", () => {
    expect(compareLaws(facts(law("W-01"), law("W-02")), facts(law("W-02"), law("W-03")))).toEqual([
      { what: "W-01", change: "weakened", before: "present", after: "removed" },
      { what: "W-03", change: "strengthened", before: "absent", after: "added" },
    ]);
  });

  it("says a severity that fell from R to A, and a law no longer judged, are weaker", () => {
    const items = compareLaws(
      facts(law("W-01")),
      facts(law("W-01", { severity: "A", judged: "no" })),
    );
    expect(items).toEqual([
      { what: "W-01: judged", change: "weakened", before: "v0.1", after: "no" },
      { what: "W-01: severity", change: "weakened", before: "R", after: "A" },
    ]);
    expect(compareLaws(facts(law("W-01", { severity: "A" })), facts(law("W-01")))[0]).toMatchObject(
      { what: "W-01: severity", change: "strengthened" },
    );
    expect(compareLaws(facts(law("W-01", { judged: "m3" })), facts(law("W-01")))).toEqual([]);
  });

  it("says a class that no longer maps the law, and a rule it no longer holds, are weaker", () => {
    const head = law("W-01", { classes: ["ts-library"], rules: [{ tool: "tsc", name: "strict" }] });
    expect(compareLaws(facts(law("W-01")), facts(head))).toEqual([
      { what: "W-01: class node-service", change: "weakened", before: "present", after: "absent" },
      {
        what: "W-01: rule eslint: no-explicit-any",
        change: "weakened",
        before: "present",
        after: "absent",
      },
      {
        what: "W-01: rule tsc: strict",
        change: "strengthened",
        before: "absent",
        after: "present",
      },
    ]);
  });

  it("lists the laws in id order, whichever order they came in", () => {
    const base = facts(law("W-09"), law("W-02"));
    const head = facts(law("W-05"));
    expect(compareLaws(base, head).map((item) => item.what)).toEqual(["W-02", "W-05", "W-09"]);
  });

  it("is empty when nothing moved", () => {
    expect(compareLaws(facts(law("W-01")), facts(law("W-01")))).toEqual([]);
  });
});
