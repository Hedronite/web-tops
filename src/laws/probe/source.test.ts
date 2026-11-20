import { describe, expect, it } from "vitest";
import { isProbed, probeLaws, sourceOf, toProbeLaw, type LawRecord } from "./source.ts";

/** Records shaped as `laws/W-NN.yaml` holds them. */
const W01: LawRecord = {
  id: "W-01",
  classes: ["ts-library", "web-app"],
  judged: "v0.1",
  rules: [
    { tool: "eslint", name: "@typescript-eslint/no-explicit-any" },
    { tool: "tsc", name: "noImplicitAny" },
  ],
};
const W22: LawRecord = {
  id: "W-22",
  classes: ["ui-components"],
  judged: "v0.1",
  rules: [
    { tool: "eslint", name: "jsx-a11y-x/alt-text" },
    { tool: "html-validate", name: "a11y" },
    { tool: "axe", name: "axe" },
  ],
};
const W16: LawRecord = {
  id: "W-16",
  classes: ["ts-library"],
  judged: "v0.1",
  rules: [{ tool: "depcruise", name: "no-circular" }],
};
const W23: LawRecord = {
  id: "W-23",
  classes: ["web-app"],
  judged: "v0.1",
  rules: [{ tool: "eslint", name: "webtops/complete-tailwind-classes" }],
};
const W47: LawRecord = {
  id: "W-47",
  classes: ["web-app"],
  judged: "no",
  rules: [{ tool: "eslint", name: "react-hooks/rules-of-hooks" }],
};

describe("G3a the laws the probe proves are read from the catalog's records", () => {
  it("takes a ticked law that a lint rule or a flag judges, with its rule names as proofs and its classes", () => {
    expect(toProbeLaw(W01)).toEqual({
      id: "W-01",
      classes: ["ts-library", "web-app"],
      proofs: ["@typescript-eslint/no-explicit-any", "noImplicitAny"],
      scoped: {},
    });
    expect(isProbed(W01)).toBe(true);
  });

  it("proves only the rules of a tool a twin can fire: a law's other tools are left to their own readers", () => {
    expect(toProbeLaw(W22).proofs).toEqual(["jsx-a11y-x/alt-text"]);
    expect(isProbed(W22)).toBe(true);
  });

  it("leaves out a law no lint rule or flag judges", () => {
    expect(isProbed(W16)).toBe(false);
    expect(isProbed({ ...W16, rules: [] })).toBe(false);
  });

  it("leaves out a law of the custom plugin, which its own step proves", () => {
    expect(isProbed(W23)).toBe(false);
    const custom = { tool: "eslint", name: "webtops/complete-tailwind-classes" };
    expect(isProbed({ ...W01, rules: [...W01.rules, custom] })).toBe(false);
  });

  it("leaves out a law that is not ticked, whatever its rules", () => {
    expect(isProbed(W47)).toBe(false);
    expect(isProbed({ ...W01, judged: "m3" })).toBe(false);
  });

  it("lists the probed laws in id order, and reads the records each time the source is called", () => {
    expect(probeLaws([W22, W16, W01, W47, W23]).map((law) => law.id)).toEqual(["W-01", "W-22"]);
    let reads = 0;
    const source = sourceOf(() => {
      reads += 1;
      return [W01];
    });
    expect(source().map((law) => law.id)).toEqual(["W-01"]);
    source();
    expect(reads).toBe(2);
  });
});

describe("R106 a rule whose entry names classes is scoped to them", () => {
  const record: LawRecord = {
    id: "W-91",
    classes: ["ui-components", "astro-site"],
    judged: "v0.1",
    rules: [
      { tool: "eslint", name: "jsx-a11y-x/alt-text" },
      { tool: "eslint", name: "astro/jsx-a11y/alt-text", classes: ["astro-site"] },
      { tool: "axe", name: "axe", classes: ["astro-site"] },
    ],
  };

  it("lists the classes of each probed rule that has them, and leaves the other rules out", () => {
    expect(toProbeLaw(record).scoped).toEqual({ "astro/jsx-a11y/alt-text": ["astro-site"] });
    expect(toProbeLaw(W01).scoped).toEqual({});
  });
});

describe("G3a the tools whose rules a twin can fire", () => {
  const law = (tool: string): LawRecord => ({
    id: "W-90",
    classes: ["ts-library"],
    judged: "v0.1",
    rules: [{ tool, name: "some-rule" }],
  });

  it("are ESLint, the compiler and Stylelint, and no other", () => {
    expect(["eslint", "tsc", "stylelint"].map((tool) => isProbed(law(tool)))).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      ["knip", "publint", "attw", "bun", "dependency-cruiser", "axe"].some((tool) =>
        isProbed(law(tool)),
      ),
    ).toBe(false);
  });
});
