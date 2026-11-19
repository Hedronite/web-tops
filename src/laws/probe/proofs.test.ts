import { describe, expect, it } from "vitest";
import { codesOf, provenBy, proves } from "./proofs.ts";

describe("G3b proofs: what a finding or a marker must name to prove a rule or a flag", () => {
  it("a rule is proven by its own id, with or without the plugin prefix, and by nothing that only ends like it", () => {
    expect(proves("no-explicit-any", "no-explicit-any")).toBe(true);
    expect(proves("no-explicit-any", "@typescript-eslint/no-explicit-any")).toBe(true);
    expect(proves("no-explicit-any", "@typescript-eslint/no-unsafe-any")).toBe(false);
    expect(proves("explicit-any", "@typescript-eslint/no-explicit-any")).toBe(false);
    expect(proves("no-explicit-any", "no-explicit-any-too")).toBe(false);
  });

  it("a flag is proven by the compiler codes it raises, and by no other code", () => {
    expect(proves("erasableSyntaxOnly", "TS1294")).toBe(true);
    expect(proves("erasableSyntaxOnly", "TS1484")).toBe(false);
    expect(proves("verbatimModuleSyntax", "TS1484")).toBe(true);
  });

  it("a code is not a rule: a name that is no flag raises none", () => {
    expect(codesOf("no-explicit-any")).toEqual([]);
    expect(codesOf("")).toEqual([]);
  });

  it("each flag of the strict family has its codes, and strict has them all", () => {
    expect(codesOf("noImplicitAny")).toEqual(["TS7006"]);
    expect(codesOf("strictNullChecks")).toEqual(["TS18047", "TS18048"]);
    expect(codesOf("strict")).toEqual(
      expect.arrayContaining(["TS7006", "TS18048", "TS18046", "TS2564"]),
    );
    expect(codesOf("strict")).not.toContain("TS1294");
  });

  it("strict is proven by a finding of any member's code", () => {
    expect(proves("strict", "TS2564")).toBe(true);
    expect(proves("strict", "TS7029")).toBe(false);
  });

  it("a marker may drop the plugin prefix of a proof that has one, and no more than the prefix", () => {
    const proof = "@typescript-eslint/no-explicit-any";
    expect(provenBy(proof, "no-explicit-any")).toBe(true);
    expect(provenBy(proof, proof)).toBe(true);
    expect(provenBy(proof, "explicit-any")).toBe(false);
    expect(provenBy(proof, "no-unsafe-any")).toBe(false);
    expect(provenBy("vitest/no-focused-tests", "no-focused-tests")).toBe(true);
    expect(proves(proof, "@typescript-eslint/no-explicit-any")).toBe(true);
  });

  it("a marker proves strict by naming a member of the family, and a flag by naming it", () => {
    expect(provenBy("strict", "strictNullChecks")).toBe(true);
    expect(provenBy("strict", "noImplicitAny")).toBe(true);
    expect(provenBy("strict", "erasableSyntaxOnly")).toBe(false);
    expect(provenBy("noImplicitOverride", "noImplicitOverride")).toBe(true);
    expect(provenBy("noImplicitOverride", "TS4114")).toBe(true);
    expect(provenBy("noImplicitOverride", "noFallthroughCasesInSwitch")).toBe(false);
  });
});

describe("G3b proofs: the whole table of codes", () => {
  it("lists exactly the codes each flag raises", () => {
    const table: Record<string, string[]> = {
      noImplicitAny: ["TS7006"],
      strictNullChecks: ["TS18047", "TS18048"],
      strictFunctionTypes: ["TS2322"],
      strictBindCallApply: ["TS2345"],
      strictPropertyInitialization: ["TS2564"],
      noImplicitThis: ["TS2683"],
      useUnknownInCatchVariables: ["TS18046"],
      noUncheckedIndexedAccess: ["TS18048"],
      exactOptionalPropertyTypes: ["TS2375", "TS2379"],
      noImplicitOverride: ["TS4114"],
      noFallthroughCasesInSwitch: ["TS7029"],
      verbatimModuleSyntax: ["TS1484"],
      isolatedModules: ["TS1205"],
      erasableSyntaxOnly: ["TS1294"],
    };
    for (const [flag, codes] of Object.entries(table)) {
      expect(codesOf(flag), flag).toEqual(codes);
    }
  });

  it("strict has the codes of the seven members of its family, in order", () => {
    expect(codesOf("strict")).toEqual([
      "TS7006",
      "TS18047",
      "TS18048",
      "TS2322",
      "TS2345",
      "TS2564",
      "TS2683",
      "TS18046",
    ]);
  });

  it("only strict is proven by a member of the family: another flag is proven by its own name", () => {
    expect(provenBy("strict", "strictNullChecks")).toBe(true);
    expect(provenBy("noImplicitAny", "strictNullChecks")).toBe(false);
    expect(provenBy("noUncheckedIndexedAccess", "noImplicitThis")).toBe(false);
    expect(provenBy("strict", "noUncheckedIndexedAccess")).toBe(false);
  });
});
