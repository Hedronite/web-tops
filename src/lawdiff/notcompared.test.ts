import { describe, expect, it } from "vitest";
import { notCompared } from "./notcompared.ts";

describe("what the diff does not compare", () => {
  it("is listed with the reason for each, as a fixed list", () => {
    expect(notCompared().map((left) => left.what)).toEqual([
      "package.json scripts",
      "CI workflow files",
      "tsconfig options that are not W-04 flags",
      "dependency-cruiser options beyond exclude and doNotFollow",
      "ESLint over files ESLint does not name by extension",
      "Stylelint over non-CSS files",
      "secretlint configuration in any file but .secretlintrc.json",
      "what .gitignore leaves out of a secretlint scan",
      "knip plugin options beyond entry and project",
      "who applied the protocol-change label",
    ]);
    for (const left of notCompared()) expect(left.reason.length).toBeGreaterThan(0);
    expect(notCompared()[9]?.reason).toBe(
      "in CI only an account with maintain or admin permission counts (R111); a local run trusts the label's presence",
    );
  });
});
