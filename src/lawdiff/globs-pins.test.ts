import { describe, expect, it } from "vitest";
import { compareGlobs } from "./globs.ts";

describe("the coverage exclusions the head dropped", () => {
  it("are listed in name order, whichever order the base had them in", () => {
    expect(compareGlobs(["z/**", "a/**", "m/**"], []).map((item) => item.where)).toEqual([
      "a/**",
      "m/**",
      "z/**",
    ]);
  });
});
