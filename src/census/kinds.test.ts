import { describe, expect, it } from "vitest";
import { AXE_KINDS, CONFIG_KINDS, KIND_MESSAGES, SOURCE_KINDS } from "./kinds.ts";

const ALL = [...SOURCE_KINDS, ...CONFIG_KINDS, ...AXE_KINDS];

describe("KIND_MESSAGES", () => {
  it("says something of every kind: a sentence, not empty", () => {
    for (const kind of ALL) expect(KIND_MESSAGES[kind].length, kind).toBeGreaterThan(20);
  });

  it("says something different of each kind", () => {
    expect(new Set(ALL.map((kind) => KIND_MESSAGES[kind])).size).toBe(ALL.length);
  });

  it("holds a message for no other kind", () => {
    expect(Object.keys(KIND_MESSAGES).sort()).toEqual([...ALL].sort());
  });

  it.each([
    ["eslint-disable", "ESLint"],
    ["ts-expect-error", "@ts-expect-error"],
    ["ts-ignore", "@ts-ignore"],
    ["ts-nocheck", "@ts-nocheck"],
    ["stylelint-disable", "stylelint"],
    ["biome-ignore", "biome-ignore"],
    ["stryker-disable", "Stryker"],
    ["html-validate-disable", "html-validate"],
    ["axe-disable-rules", "axe"],
    ["axe-exclude", "axe"],
    ["eslint-rule-off", "ESLint"],
    ["eslint-ignores", "ESLint"],
    ["tsconfig-exclude", "tsconfig"],
  ] as const)("names the tool of %s", (kind, word) => {
    expect(KIND_MESSAGES[kind]).toContain(word);
  });
});
