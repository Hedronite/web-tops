import { describe, expect, it } from "vitest";
import { compareLevels } from "./levels.ts";
import type { Rules } from "./types.ts";

const rules = (options: string, level = 2): Rules =>
  new Map([["a.ts", new Map([["complexity", { level, options }]])]]);

const change = (before: string, after: string): string | undefined =>
  compareLevels(rules(before), rules(after), new Map(), ["a.ts"])[0]?.change;

describe("a ceiling rule's options", () => {
  it("are for review, not an error, when the first option is null", () => {
    expect(change("[null]", "[4]")).toBe("changed");
    expect(change("[4]", "[null]")).toBe("changed");
    expect(change("[null]", "[null, 1]")).toBe("changed");
  });
});

describe("the rules that did not move", () => {
  it("are not listed, however many there are beside one that did", () => {
    const base: Rules = new Map([
      [
        "a.ts",
        new Map([
          ["x", { level: 2, options: "[]" }],
          ["y", { level: 2, options: "[]" }],
          ["z", { level: 2, options: "[]" }],
        ]),
      ],
    ]);
    const head: Rules = new Map([
      [
        "a.ts",
        new Map([
          ["x", { level: 2, options: "[]" }],
          ["y", { level: 0, options: "[]" }],
          ["z", { level: 2, options: "[]" }],
        ]),
      ],
    ]);
    expect(compareLevels(base, head, new Map(), ["a.ts"]).map((item) => item.what)).toEqual(["y"]);
  });
});
