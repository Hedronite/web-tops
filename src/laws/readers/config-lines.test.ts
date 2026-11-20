import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../probe/testkit.ts";
import { configTexts, loweringLines, lowerings } from "./config-lines.ts";

afterAll(cleanTemp);

describe("G4c config lines: where a config puts a rule below error", () => {
  it("finds a rule set to off or warn, with or without its plugin prefix, on its own line", () => {
    const text = [
      "export default [",
      "  {",
      '    rules: { "@typescript-eslint/no-explicit-any": "off" },',
      "  },",
      '  { rules: { "no-explicit-any": "warn" } },',
      "  { rules: { 'no-explicit-any': 'off' } },",
      "];",
    ].join("\n");
    expect(loweringLines(text, "@typescript-eslint/no-explicit-any")).toEqual([3, 5, 6]);
    expect(loweringLines(text, "no-explicit-any")).toEqual([3, 5, 6]);
  });

  it("reads the numeric levels and an unquoted key", () => {
    expect(loweringLines("rules: { a: 0, b: 1, c: 2 }", "a")).toEqual([1]);
    expect(loweringLines("rules: { a: 0, b: 1, c: 2 }", "b")).toEqual([1]);
    expect(loweringLines("rules: { a: 0, b: 1, c: 2 }", "c")).toEqual([]);
  });

  it("reads the array form, on one line or across lines", () => {
    const text = 'rules: {\n  "x/r": [\n    "off",\n    { a: 1 },\n  ],\n  "x/s": ["warn", {}],\n}';
    expect(loweringLines(text, "x/r")).toEqual([2]);
    expect(loweringLines(text, "x/s")).toEqual([6]);
  });

  it("does not take a rule at error, an option value, or another rule that ends in the same letters", () => {
    const text = [
      'rules: { "a/no-explicit-any": "error" },',
      'rules: { "a/no-explicit-any": ["error", { x: "off" }] },',
      'rules: { "a/no-implicit-any": "off", "my-no-explicit-any": "off" },',
    ].join("\n");
    expect(loweringLines(text, "a/no-explicit-any")).toEqual([]);
  });

  it("reads a linter option set to false", () => {
    const text = "linterOptions: {\n  reportUnusedDisableDirectives: false,\n},";
    expect(loweringLines(text, "reportUnusedDisableDirectives")).toEqual([2]);
    expect(
      loweringLines("reportUnusedDisableDirectives: true", "reportUnusedDisableDirectives"),
    ).toEqual([]);
  });
});

describe("G4c config lines: the config and the files it imports", () => {
  it("reads the config and the local files it imports, one level, by project-relative path", () => {
    const cwd = tempDir();
    put(cwd, {
      "eslint.config.js": 'import rules from "./config/rules.js";\nexport default [rules];\n',
      "config/rules.js": 'export default { rules: { "no-explicit-any": "off" } };\n',
      "config/deeper.js": "x\n",
    });
    const texts = configTexts(cwd, "eslint.config.js");
    expect(texts.map((text) => text.file)).toEqual([
      "eslint.config.js",
      join("config", "rules.js"),
    ]);
    expect(lowerings(texts, "no-explicit-any")).toEqual([
      { file: join("config", "rules.js"), line: 1 },
    ]);
  });

  it("resolves an import with no extension, and leaves out a package or a file that is not there", () => {
    const cwd = tempDir();
    put(cwd, {
      "eslint.config.mjs": [
        'import a from "./a";',
        'import b from "./missing.js";',
        'import c from "typescript-eslint";',
      ].join("\n"),
      "a.mjs": "export default 1;\n",
    });
    expect(configTexts(cwd, "eslint.config.mjs").map((text) => text.file)).toEqual([
      "eslint.config.mjs",
      "a.mjs",
    ]);
  });

  it("a config that is not there has no text", () => {
    expect(configTexts(tempDir(), "eslint.config.js")).toEqual([]);
  });
});

describe("G4c config lines: the edges", () => {
  it("a rule's name is literal: a dot in it is a dot, not any character", () => {
    expect(loweringLines('{ "noXx": "off" }', "no.x")).toEqual([]);
    expect(loweringLines('{ "no.x": "off" }', "no.x")).toEqual([1]);
    expect(loweringLines('{ "a+b": "off" }', "a+b")).toEqual([1]);
    expect(loweringLines('{ "aab": "off" }', "a+b")).toEqual([]);
  });

  it("follows an import written with no space after from, and one that goes up a directory", () => {
    const cwd = tempDir();
    put(cwd, {
      "config/eslint.config.js": 'export * from"../shared/rules.js";\n',
      "shared/rules.js": 'export default { "no-explicit-any": "off" };\n',
    });
    const texts = configTexts(cwd, join("config", "eslint.config.js"));
    expect(texts.map((text) => text.file)).toEqual([
      join("config", "eslint.config.js"),
      join("shared", "rules.js"),
    ]);
  });

  it("resolves an import with no extension to each kind of config file", () => {
    const cwd = tempDir();
    const names = ["a.js", "b.mjs", "c.cjs", "d.ts", "e.mts", "f.cts"];
    put(cwd, {
      "eslint.config.js": names
        .map((name) => `export * from "./${String(name.split(".")[0])}";`)
        .join("\n"),
      ...Object.fromEntries(names.map((name) => [name, "export default 1;\n"])),
    });
    expect(configTexts(cwd, "eslint.config.js").map((text) => text.file)).toEqual([
      "eslint.config.js",
      ...names,
    ]);
  });
});
