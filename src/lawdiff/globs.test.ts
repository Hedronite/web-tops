import { describe, expect, it } from "vitest";
import { compareGlobs } from "./globs.ts";

describe("the coverage exclusions that moved", () => {
  it("lists a glob the head excludes as weaker and one it dropped as stronger, each by name order", () => {
    expect(compareGlobs(["src/gen/**", "old/**"], ["src/**", "src/gen/**", "also/**"])).toEqual([
      {
        what: "gates.coverage.exclude",
        change: "weakened",
        before: "covered",
        after: "excluded",
        where: "also/**",
      },
      {
        what: "gates.coverage.exclude",
        change: "weakened",
        before: "covered",
        after: "excluded",
        where: "src/**",
      },
      {
        what: "gates.coverage.exclude",
        change: "strengthened",
        before: "excluded",
        after: "covered",
        where: "old/**",
      },
    ]);
  });

  it("is empty when the same globs are excluded", () => {
    expect(compareGlobs(["a", "b"], ["b", "a"])).toEqual([]);
    expect(compareGlobs([], [])).toEqual([]);
  });

  it("is weaker when one glob is swapped for a broader one", () => {
    expect(compareGlobs(["src/gen/**"], ["src/**"]).map((item) => item.change)).toEqual([
      "weakened",
      "strengthened",
    ]);
  });
});
