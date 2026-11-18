import { describe, expect, it } from "vitest";
import { eslintIgnores, ruleOff, tsconfigExcluded } from "./config.ts";
import type { Levels } from "./config.ts";

const levels = (table: Record<string, Record<string, number>>): Levels =>
  new Map(Object.entries(table).map(([file, rules]) => [file, new Map(Object.entries(rules))]));

describe("eslintIgnores: each tracked file ESLint leaves out", () => {
  it("counts the files that are ignored, in file order, and not the others", () => {
    const found = eslintIgnores(
      new Map([
        ["src/legacy/b.ts", true],
        ["src/ok.ts", false],
        ["src/legacy/a.ts", true],
      ]),
    );
    expect(found).toEqual([
      { kind: "eslint-ignores", file: "src/legacy/a.ts" },
      { kind: "eslint-ignores", file: "src/legacy/b.ts" },
    ]);
  });

  it("is empty when nothing is ignored", () => {
    expect(eslintIgnores(new Map([["src/a.ts", false]]))).toEqual([]);
    expect(eslintIgnores(new Map())).toEqual([]);
  });
});

describe("ruleOff: a per-file override that sets a rule off", () => {
  it("counts each (rule, file) pair that is off while the rule is on for another file", () => {
    const found = ruleOff(
      levels({
        "src/strict.ts": { "no-any": 2, "no-console": 1 },
        "src/legacy/loose.ts": { "no-any": 0, "no-console": 1 },
        "src/legacy/other.ts": { "no-any": 0, "no-console": 0 },
      }),
    );
    expect(found).toEqual([
      { kind: "eslint-rule-off", file: "src/legacy/loose.ts", rule: "no-any" },
      { kind: "eslint-rule-off", file: "src/legacy/other.ts", rule: "no-any" },
      { kind: "eslint-rule-off", file: "src/legacy/other.ts", rule: "no-console" },
    ]);
  });

  it("does not count a rule that is off everywhere: for a required law that is a refusal, not a census item", () => {
    expect(ruleOff(levels({ "a.ts": { "no-any": 0 }, "b.ts": { "no-any": 0 } }))).toEqual([]);
  });

  it("does not count a rule that is on everywhere, or a file the rule is not configured for", () => {
    expect(ruleOff(levels({ "a.ts": { "no-any": 2 }, "b.ts": { "no-any": 1 } }))).toEqual([]);
    expect(ruleOff(levels({ "a.ts": { "no-any": 2 }, "b.ts": {} }))).toEqual([]);
  });

  it("does not count a rule that is off for a file of one extension while it is on only for files of another (R77)", () => {
    const found = ruleOff(
      levels({
        "src/a.ts": { "no-any": 2 },
        "scripts/b.js": { "no-any": 0 },
        "scripts/c.mjs": { "no-any": 0 },
      }),
    );
    expect(found).toEqual([]);
  });

  it("counts the pair when the rule is on for another file with the same extension, and not the other extensions", () => {
    const found = ruleOff(
      levels({
        "src/a.ts": { "no-any": 2 },
        "src/legacy/b.ts": { "no-any": 0 },
        "scripts/c.js": { "no-any": 0 },
      }),
    );
    expect(found).toEqual([{ kind: "eslint-rule-off", file: "src/legacy/b.ts", rule: "no-any" }]);
  });

  it("judges each extension on its own: on and off for .js counts, though .ts has the rule on everywhere", () => {
    const found = ruleOff(
      levels({
        "a.ts": { r: 2 },
        "b.ts": { r: 2 },
        "x.js": { r: 1 },
        "y.js": { r: 0 },
      }),
    );
    expect(found).toEqual([{ kind: "eslint-rule-off", file: "y.js", rule: "r" }]);
  });

  it("takes extensions without regard to case, and a file with no extension as its own group", () => {
    expect(ruleOff(levels({ "a.TS": { r: 2 }, "b.ts": { r: 0 } }))).toEqual([
      { kind: "eslint-rule-off", file: "b.ts", rule: "r" },
    ]);
    expect(ruleOff(levels({ Makefile: { r: 2 }, Dockerfile: { r: 0 } }))).toEqual([
      { kind: "eslint-rule-off", file: "Dockerfile", rule: "r" },
    ]);
    expect(ruleOff(levels({ "a.ts": { r: 2 }, Dockerfile: { r: 0 } }))).toEqual([]);
  });

  it("puts two extensions in one group when they differ only in case, whichever way the case is folded", () => {
    // The Kelvin sign lowercases to "k" but is its own capital: only folding to lower case puts it with ".k".
    expect(ruleOff(levels({ "a.k": { r: 2 }, "b.\u212A": { r: 0 } }))).toEqual([
      { kind: "eslint-rule-off", file: "b.\u212A", rule: "r" },
    ]);
  });

  it("counts a warning as on, and orders the pairs by file and then rule", () => {
    const found = ruleOff(levels({ "z.ts": { b: 0, a: 0 }, "a.ts": { a: 1, b: 1 } }));
    expect(found.map((hit) => `${hit.file}:${hit.rule}`)).toEqual(["z.ts:a", "z.ts:b"]);
  });

  it("is empty with no files", () => {
    expect(ruleOff(new Map())).toEqual([]);
  });
});

describe("tsconfigExcluded: tracked files the program does not hold", () => {
  it("counts each candidate that is not in the program, in file order", () => {
    expect(tsconfigExcluded(["src/z.ts", "src/ok.ts", "src/a.ts"], new Set(["src/ok.ts"]))).toEqual(
      [
        { kind: "tsconfig-exclude", file: "src/a.ts" },
        { kind: "tsconfig-exclude", file: "src/z.ts" },
      ],
    );
  });

  it("is empty when the program holds every candidate", () => {
    expect(tsconfigExcluded(["src/ok.ts"], new Set(["src/ok.ts", "src/extra.ts"]))).toEqual([]);
    expect(tsconfigExcluded([], new Set())).toEqual([]);
  });
});

describe("the order of the items", () => {
  it("lists ignored files in file order, whatever order they were asked in", () => {
    const found = eslintIgnores(
      new Map([
        ["d.ts", true],
        ["b.ts", true],
        ["c.ts", true],
        ["a.ts", true],
      ]),
    );
    expect(found.map((hit) => hit.file)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });

  it("lists excluded files in file order", () => {
    expect(
      tsconfigExcluded(["d.ts", "b.ts", "c.ts", "a.ts"], new Set()).map((hit) => hit.file),
    ).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });

  it("lists rule-off pairs by file, then by rule, whatever order they came in", () => {
    const found = ruleOff(
      levels({
        "b.ts": { z: 0, a: 0 },
        "a.ts": { z: 0, a: 0, k: 2 },
        "c.ts": { k: 2, a: 2, z: 2 },
      }),
    );
    expect(found.map((hit) => `${hit.file}:${hit.rule}`)).toEqual([
      "a.ts:a",
      "a.ts:z",
      "b.ts:a",
      "b.ts:z",
    ]);
  });
});
