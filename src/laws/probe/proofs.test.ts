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

  it("a marker proves strict by naming a member of the family, and a flag by naming it", () => {
    expect(provenBy("strict", "strictNullChecks")).toBe(true);
    expect(provenBy("strict", "noImplicitAny")).toBe(true);
    expect(provenBy("strict", "erasableSyntaxOnly")).toBe(false);
    expect(provenBy("noImplicitOverride", "noImplicitOverride")).toBe(true);
    expect(provenBy("noImplicitOverride", "TS4114")).toBe(true);
    expect(provenBy("noImplicitOverride", "noFallthroughCasesInSwitch")).toBe(false);
  });
});
