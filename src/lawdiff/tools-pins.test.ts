import { describe, expect, it } from "vitest";
import { toolsOf } from "./tools.ts";

describe("the tools of a project with no lock", () => {
  it("are the kit's pinned tools and webtops by package.json, and any other name, even an odd one, is other", () => {
    const manifest = {
      devDependencies: {
        "Stryker was here": "1.0.0",
        eslint: "10.15.0",
        webtops: "0.3.0",
        lonely: "1.0.0",
      },
    };
    expect([...toolsOf(manifest, undefined)]).toEqual([
      ["other: Stryker was here", "1.0.0"],
      ["package.json: eslint", "10.15.0"],
      ["package.json: webtops", "0.3.0"],
      ["other: lonely", "1.0.0"],
    ]);
    expect([...toolsOf(manifest)].map(([key]) => key)).toEqual(
      [...toolsOf(manifest, undefined)].map(([key]) => key),
    );
  });
});
