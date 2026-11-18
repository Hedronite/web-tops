import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { axeFindings, readAxe } from "./axe.ts";

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const read = (source: string, file = "a.test.ts") => readAxe(ts, file, source);

const hits = (source: string): string[] =>
  read(source).hits.map((hit) => `${hit.kind}:${hit.text}@${String(hit.line)}`);

const unreadable = (source: string): string[] =>
  read(source).unreadable.map((item) => `${item.method}@${String(item.line)}`);

describe("readAxe: a .disableRules([...]) or .exclude([...]) call on an AxeBuilder (WEB_TOPS.md 6.7)", () => {
  it("counts each string of a literal array, with the line of the string", () => {
    const source = [
      "const r = await new AxeBuilder({ page })",
      '  .disableRules(["color-contrast", "region"])',
      "  .analyze();",
    ].join("\n");
    expect(hits(source)).toEqual([
      "axe-disable-rules:color-contrast@2",
      "axe-disable-rules:region@2",
    ]);
  });

  it("counts each selector of an exclude, and a multi-line array on the lines of its strings", () => {
    const source = [
      "new AxeBuilder({ page }).exclude([",
      '  ".legacy-banner",',
      '  "#ad",',
      "]);",
    ].join("\n");
    expect(hits(source)).toEqual(["axe-exclude:.legacy-banner@2", "axe-exclude:#ad@3"]);
  });

  it("counts a single string, which both methods take", () => {
    expect(hits('new AxeBuilder({ page }).exclude("#ad");')).toEqual(["axe-exclude:#ad@1"]);
    expect(hits('new AxeBuilder({ page }).disableRules("region");')).toEqual([
      "axe-disable-rules:region@1",
    ]);
  });

  it("counts both methods in one chain, with other builder calls between them, in source order", () => {
    const source =
      'new AxeBuilder({ page }).withTags(["wcag2a"]).exclude(["#a"]).include("main").disableRules(["r1"]).analyze();';
    expect(hits(source)).toEqual(["axe-exclude:#a@1", "axe-disable-rules:r1@1"]);
  });

  it("counts a call whose receiver is parenthesized, awaited or typed", () => {
    expect(hits('(new AxeBuilder({ page }) as AxeBuilder).exclude(["#a"]);')).toEqual([
      "axe-exclude:#a@1",
    ]);
    expect(hits('(new AxeBuilder({ page })).exclude(["#a"]);')).toEqual(["axe-exclude:#a@1"]);
  });

  it("counts a call on a builder held in a variable of the same file", () => {
    const source = [
      "const builder = new AxeBuilder({ page });",
      'builder.exclude(["#a"]);',
      'const tagged = builder.withTags(["wcag2a"]);',
      'tagged.disableRules(["r1"]);',
    ].join("\n");
    expect(hits(source)).toEqual(["axe-exclude:#a@2", "axe-disable-rules:r1@4"]);
  });

  it("counts a builder reached through a namespace, as `new axe.AxeBuilder(...)`", () => {
    expect(hits('new playwrightAxe.AxeBuilder({ page }).exclude(["#a"]);')).toEqual([
      "axe-exclude:#a@1",
    ]);
  });

  it("reads a literal array that is `as const`, parenthesized or satisfies a type, and a template without substitutions", () => {
    expect(hits('new AxeBuilder({ page }).exclude(["#a"] as const);')).toEqual([
      "axe-exclude:#a@1",
    ]);
    expect(hits('new AxeBuilder({ page }).exclude((["#a"]));')).toEqual(["axe-exclude:#a@1"]);
    expect(hits("new AxeBuilder({ page }).exclude([`#a`]);")).toEqual(["axe-exclude:#a@1"]);
    expect(hits('new AxeBuilder({ page }).exclude(["#a"] satisfies string[]);')).toEqual([
      "axe-exclude:#a@1",
    ]);
  });

  it("counts nothing for an empty array or no argument, and says nothing about them", () => {
    expect(read("new AxeBuilder({ page }).exclude([]).disableRules();")).toEqual({
      hits: [],
      unreadable: [],
    });
  });

  it("reads TSX and JavaScript files too", () => {
    expect(read('const a = new AxeBuilder({ page }).exclude(["#a"]);', "a.js").hits).toHaveLength(
      1,
    );
    expect(
      read('const a = <p>{new AxeBuilder({ page }).exclude(["#a"])}</p>;', "a.tsx").hits,
    ).toHaveLength(1);
  });
});

describe("readAxe: what is not an axe setting", () => {
  it.each([
    ["an unrelated exclude on a config object", 'config.exclude(["a", "b"]);'],
    ["an unrelated disableRules", 'linter.disableRules(["a"]);'],
    ["an exclude on a different builder", 'new Other({ page }).exclude(["a"]);'],
    ["a plain function called exclude", 'exclude(["a"]);'],
    [
      "a call on an object that merely has a builder in its name",
      'axeBuilderOptions.exclude(["a"]);',
    ],
    ["an exclude on a chain that begins at a different new", 'new Set().add(1).exclude(["a"]);'],
    ["a variable that is not a builder", 'const files = glob("x");\nfiles.exclude(["a"]);'],
    ["the words in a string", "const s = 'new AxeBuilder({ page }).exclude([\"a\"])';"],
    ["the words in a comment", '// new AxeBuilder({ page }).exclude(["a"])'],
    ["the words in a template literal", 'const s = `new AxeBuilder({ page }).exclude(["a"])`;'],
    ["an include, which is not a suppression", 'new AxeBuilder({ page }).include(["main"]);'],
    ["withRules, which turns rules on", 'new AxeBuilder({ page }).withRules(["region"]);'],
  ])("does not count %s", (_name, source) => {
    expect(read(source)).toEqual({ hits: [], unreadable: [] });
  });

  it("does not take a variable for a builder when it was not given one", () => {
    expect(
      read('let b = something();\nb = new AxeBuilder({ page });\nb.exclude(["a"]);').hits,
    ).toEqual([]);
  });
});

describe("readAxe: an argument that is not a literal string or array of them is unreadable, never a zero", () => {
  it.each([
    ["a variable", "new AxeBuilder({ page }).exclude(selectors);", "exclude@1"],
    ["a call", "new AxeBuilder({ page }).disableRules(rulesToSkip());", "disableRules@1"],
    [
      "an array with a variable in it",
      'new AxeBuilder({ page }).exclude(["#a", other]);',
      "exclude@1",
    ],
    ["a spread", 'new AxeBuilder({ page }).exclude([...base, "#a"]);', "exclude@1"],
    [
      "a template with a substitution",
      "new AxeBuilder({ page }).exclude([`#${id}`]);",
      "exclude@1",
    ],
    ["a concatenation", 'new AxeBuilder({ page }).exclude(["#" + id]);', "exclude@1"],
    ["a property", "new AxeBuilder({ page }).disableRules(config.rules);", "disableRules@1"],
    ["a number in the array", "new AxeBuilder({ page }).exclude([1]);", "exclude@1"],
  ])("says so for %s", (_name, source, expected) => {
    expect(unreadable(source)).toEqual([expected]);
  });

  it("counts the strings of a call it can read, and reports the call it cannot, in one file", () => {
    const source = [
      'new AxeBuilder({ page }).exclude(["#a"]);',
      "new AxeBuilder({ page }).exclude(list);",
    ].join("\n");
    const found = read(source);
    expect(found.hits.map((hit) => hit.text)).toEqual(["#a"]);
    expect(found.unreadable.map((item) => item.line)).toEqual([2]);
  });

  it("reports one unreadable for a call whose array holds both strings and a variable, and counts none of it", () => {
    const found = read('new AxeBuilder({ page }).exclude(["#a", other]);');
    expect(found.hits).toEqual([]);
    expect(found.unreadable).toHaveLength(1);
  });

  it("reports the line of the argument", () => {
    expect(unreadable("new AxeBuilder({ page })\n  .exclude(\n    selectors,\n  );")).toEqual([
      "exclude@3",
    ]);
  });
});

describe("axeFindings: the project's files", () => {
  function project(files: Readonly<Record<string, string>>): string {
    const root = resolve(import.meta.dirname, "../..");
    mkdirSync(join(root, "tmp"), { recursive: true });
    const dir = mkdtempSync(join(root, "tmp", "wt-census-axe-"));
    made.push(dir);
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return dir;
  }

  const SETTINGS = 'new AxeBuilder({ page }).disableRules(["region"]).exclude(["#ad"]);\n';

  it("gives a pass finding per setting, rule census/axe-<kind>, with file, line and what is set", () => {
    const dir = project({ "e2e/a11y.test.ts": SETTINGS });
    const found = axeFindings(dir, ["e2e/a11y.test.ts"]);
    expect(found).toMatchObject([
      {
        tool: "webtops",
        rule: "census/axe-disable-rules",
        verdict: "pass",
        file: "e2e/a11y.test.ts",
        line: 1,
      },
      {
        tool: "webtops",
        rule: "census/axe-exclude",
        verdict: "pass",
        file: "e2e/a11y.test.ts",
        line: 1,
      },
    ]);
    expect(found[0]?.message).toContain("region");
    expect(found[1]?.message).toContain("#ad");
  });

  it("gives a failing census-axe-unreadable finding, with file and line, for an argument it cannot read", () => {
    const dir = project({
      "e2e/a.test.ts": "const x = 1;\nnew AxeBuilder({ page }).exclude(list);\n",
    });
    expect(axeFindings(dir, ["e2e/a.test.ts"])).toMatchObject([
      {
        tool: "webtops",
        rule: "census-axe-unreadable",
        verdict: "fail",
        file: "e2e/a.test.ts",
        line: 2,
      },
    ]);
  });

  it("reads only tracked script files outside the output folders, and skips a file with no AxeBuilder without parsing it", () => {
    const dir = project({
      "a.test.ts": SETTINGS,
      "untracked.test.ts": SETTINGS,
      "dist/b.test.ts": SETTINGS,
      "node_modules/p/c.ts": SETTINGS,
      "notes.md": SETTINGS,
      "plain.ts": "export const x = 1;\nfiles.exclude(['a']);\n",
    });
    const found = axeFindings(dir, [
      "a.test.ts",
      "dist/b.test.ts",
      "node_modules/p/c.ts",
      "notes.md",
      "plain.ts",
      "missing.ts",
    ]);
    expect(found.map((item) => item.file)).toEqual(["a.test.ts", "a.test.ts"]);
  });

  it("is empty for a project that never names AxeBuilder, and needs no TypeScript for it", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-census-axe-nots-"));
    made.push(dir);
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    expect(axeFindings(dir, ["a.ts"])).toEqual([]);
  });

  it("fails, rather than reading as zero, when the project names AxeBuilder and has no TypeScript to read it with", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-census-axe-nots-"));
    made.push(dir);
    writeFileSync(join(dir, "a.ts"), SETTINGS);
    const found = axeFindings(dir, ["a.ts"]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: "census-axe-unreadable", verdict: "fail" });
    expect(found[0]?.message).toContain("typescript");
  });
});
