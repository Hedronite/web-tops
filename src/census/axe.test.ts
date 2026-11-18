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

  it("does not take a variable for a builder that was never given one", () => {
    expect(read('let b = something();\nb.exclude(["a"]);').hits).toEqual([]);
    expect(read('const b = something();\nb.exclude(["a"]);').hits).toEqual([]);
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

describe("readAxe: more edges", () => {
  it("does not take `new ns.Other(...)` for a builder: only a member named AxeBuilder is one", () => {
    expect(read('new pw.Other({ page }).exclude(["a"]);')).toEqual({ hits: [], unreadable: [] });
    expect(read('new pw.AxeBuilder({ page }).exclude(["a"]);').hits).toHaveLength(1);
  });

  it("lists unreadable calls in source order, though the chain's outer call is visited first", () => {
    const source = [
      "new AxeBuilder({ page })",
      "  .exclude(first)",
      "  .disableRules(second);",
    ].join("\n");
    expect(read(source).unreadable.map((item) => `${item.method}@${String(item.line)}`)).toEqual([
      "exclude@2",
      "disableRules@3",
    ]);
  });
});

describe("axeFindings: the words of a finding", () => {
  it("names the method and says why the argument cannot be counted", () => {
    const root = resolve(import.meta.dirname, "../..");
    mkdirSync(join(root, "tmp"), { recursive: true });
    const dir = mkdtempSync(join(root, "tmp", "wt-census-axe-msg-"));
    made.push(dir);
    writeFileSync(join(dir, "a.ts"), "new AxeBuilder({ page }).disableRules(list);\n");
    const found = axeFindings(dir, ["a.ts"]);
    expect(found[0]?.message).toBe(
      ".disableRules() on an AxeBuilder is not given a literal string or an array of literal strings, so what it sets cannot be counted",
    );
  });
});

describe("readAxe: the builder's local name comes from the import or require of an axe package (AXE-3)", () => {
  const settings = (source: string): string[] =>
    read(source).hits.map((hit) => `${hit.kind}:${hit.text}`);

  it.each([
    [
      "a renamed default import",
      'import Axe from "@axe-core/playwright";\nnew Axe({ page }).exclude(["#a"]);',
    ],
    [
      "a named import",
      'import { AxeBuilder } from "@axe-core/playwright";\nnew AxeBuilder({ page }).exclude(["#a"]);',
    ],
    [
      "a renamed named import",
      'import { AxeBuilder as B } from "@axe-core/playwright";\nnew B({ page }).exclude(["#a"]);',
    ],
    [
      "the default as a named import",
      'import { default as B } from "@axe-core/playwright";\nnew B({ page }).exclude(["#a"]);',
    ],
    [
      "a default and a named import together",
      'import Axe, { AxeBuilder as B } from "@axe-core/playwright";\nnew B({ page }).exclude(["#a"]);',
    ],
    [
      "a namespace import, through default",
      'import * as ax from "@axe-core/playwright";\nnew ax.default({ page }).exclude(["#a"]);',
    ],
    [
      "a namespace import, through AxeBuilder",
      'import * as ax from "@axe-core/playwright";\nnew ax.AxeBuilder({ page }).exclude(["#a"]);',
    ],
    [
      "another axe package",
      'import AxePuppeteer from "@axe-core/puppeteer";\nnew AxePuppeteer(page).exclude(["#a"]);',
    ],
    [
      "the named export of another axe package",
      'import { AxePuppeteer } from "@axe-core/puppeteer";\nnew AxePuppeteer(page).exclude(["#a"]);',
    ],
    [
      "the named export of another axe package, through a namespace",
      'import * as ax from "@axe-core/puppeteer";\nnew ax.AxePuppeteer(page).exclude(["#a"]);',
    ],
    [
      "a require of the default",
      'const Axe = require("@axe-core/playwright").default;\nnew Axe({ page }).exclude(["#a"]);',
    ],
    [
      "a destructured require",
      'const { AxeBuilder } = require("@axe-core/playwright");\nnew AxeBuilder({ page }).exclude(["#a"]);',
    ],
    [
      "a renamed destructured require",
      'const { AxeBuilder: B } = require("@axe-core/playwright");\nnew B({ page }).exclude(["#a"]);',
    ],
    [
      "a destructured default",
      'const { default: B } = require("@axe-core/playwright");\nnew B({ page }).exclude(["#a"]);',
    ],
    [
      "a require of the module",
      'const ax = require("@axe-core/playwright");\nnew ax.AxeBuilder({ page }).exclude(["#a"]);',
    ],
    [
      "a dynamic import",
      'const { default: B } = await import("@axe-core/playwright");\nnew B({ page }).exclude(["#a"]);',
    ],
    [
      "a dynamic import of the module",
      'const ax = await import("@axe-core/playwright");\nnew ax.default({ page }).exclude(["#a"]);',
    ],
  ])("counts the settings of %s", (_name, source) => {
    expect(settings(source)).toEqual(["axe-exclude:#a"]);
  });

  it("does not take a class from a package that is not axe's", () => {
    expect(
      settings('import Axe from "other-package";\nnew Axe({ page }).exclude(["#a"]);'),
    ).toEqual([]);
    expect(settings('const Axe = require("other-package");\nnew Axe().exclude(["#a"]);')).toEqual(
      [],
    );
    expect(
      settings('import { AxeBuilder as B } from "not-axe";\nnew B({ page }).exclude(["#a"]);'),
    ).toEqual([]);
  });

  it("does not take a named import of something that is not the builder for the class", () => {
    expect(
      settings(
        'import { helper } from "@axe-core/playwright";\nnew helper({ page }).exclude(["#a"]);',
      ),
    ).toEqual([]);
  });

  it("reads a side-effect import, and an import with no bindings, without finding a class", () => {
    expect(settings('import "@axe-core/playwright";\nnew Thing().exclude(["#a"]);')).toEqual([]);
  });

  it("holds a builder from a function of the file that returns one", () => {
    const arrow = 'const make = () => new AxeBuilder({ page });\nmake().exclude(["#a"]);';
    const block =
      'const make = (p) => {\n  const b = new AxeBuilder({ page: p });\n  return b.withTags(["x"]);\n};\nmake(page).exclude(["#a"]);';
    const declared =
      'function make(p) { return new AxeBuilder({ page: p }); }\nmake(page).exclude(["#a"]);';
    const expression =
      'const make = function (p) { return new AxeBuilder({ page: p }); };\nmake(page).exclude(["#a"]);';
    for (const source of [arrow, block, declared, expression])
      expect(settings(source)).toEqual(["axe-exclude:#a"]);
  });

  it("counts a disableRules on a builder a function returns, and follows a maker used by another", () => {
    const source = [
      "const make = () => new AxeBuilder({ page });",
      "const tagged = () => make().withTags(['a']);",
      'tagged().disableRules(["color-contrast"]);',
    ].join("\n");
    expect(settings(source)).toEqual(["axe-disable-rules:color-contrast"]);
  });

  it("does not take a function that returns something else for a maker, or a nested function's return for its own", () => {
    expect(settings('const make = () => new Other();\nmake().exclude(["#a"]);')).toEqual([]);
    const nested =
      'function outer() {\n  const inner = () => new AxeBuilder({ page });\n  return 1;\n}\nouter().exclude(["#a"]);';
    expect(settings(nested)).toEqual([]);
  });

  it("holds a builder from `let b;` and a later assignment", () => {
    expect(settings('let b;\nb = new AxeBuilder({ page });\nb.disableRules(["x"]);')).toEqual([
      "axe-disable-rules:x",
    ]);
    expect(
      settings('let b;\nb = new AxeBuilder({ page }).withTags(["t"]);\nb.exclude(["#a"]);'),
    ).toEqual(["axe-exclude:#a"]);
    expect(settings('let b;\nb += new AxeBuilder({ page });\nb.exclude(["#a"]);')).toEqual([]);
  });

  it("holds a builder from a parameter or a variable typed as the class", () => {
    expect(
      settings('function run(builder: AxeBuilder) {\n  builder.disableRules(["x"]);\n}'),
    ).toEqual(["axe-disable-rules:x"]);
    expect(settings('const run = (b: AxeBuilder) => b.exclude(["#a"]);')).toEqual([
      "axe-exclude:#a",
    ]);
    expect(settings('let b: AxeBuilder;\nb.exclude(["#a"]);')).toEqual(["axe-exclude:#a"]);
    expect(
      settings(
        'import Axe from "@axe-core/playwright";\nfunction run(b: Axe) { b.exclude(["#a"]); }',
      ),
    ).toEqual(["axe-exclude:#a"]);
    expect(
      settings(
        'import * as ax from "@axe-core/playwright";\nfunction run(b: ax.AxeBuilder) { b.exclude(["#a"]); }',
      ),
    ).toEqual(["axe-exclude:#a"]);
  });

  it("does not take a parameter typed as something else for a builder", () => {
    expect(settings('function run(b: Other) { b.exclude(["#a"]); }')).toEqual([]);
    expect(settings('function run(b: ns.Other) { b.exclude(["#a"]); }')).toEqual([]);
    expect(settings('function run(b) { b.exclude(["#a"]); }')).toEqual([]);
    expect(settings('function run(b: string[]) { b.exclude(["#a"]); }')).toEqual([]);
  });
});

describe("readAxe: only what an axe package gives is the builder, and a chain of makers is followed to its end", () => {
  const settings = (source: string): string[] =>
    read(source).hits.map((hit) => `${hit.kind}:${hit.text}`);

  it("does not take a property of something that is not an axe module for the class", () => {
    const head = 'import * as ax from "@axe-core/playwright";\n';
    expect(settings(`${head}new other.default({ page }).exclude(["#a"]);`)).toEqual([]);
    expect(settings(`${head}new a.b.default({ page }).exclude(["#a"]);`)).toEqual([]);
    expect(settings(`${head}new ax.Other({ page }).exclude(["#a"]);`)).toEqual([]);
    expect(settings(`${head}new ax({ page }).exclude(["#a"]);`)).toEqual([]);
  });

  it("takes a require or an import of an axe package for a module only when the call is one and names an axe package", () => {
    const use = "new ax.default({ page }).exclude(['#a']);";
    expect(settings(`const ax = other("@axe-core/playwright");\n${use}`)).toEqual([]);
    expect(settings(`const ax = lib.load("@axe-core/playwright");\n${use}`)).toEqual([]);
    expect(settings(`const ax = require("other-package");\n${use}`)).toEqual([]);
    expect(settings(`const ax = require(name);\n${use}`)).toEqual([]);
    expect(settings(`const ax = require();\n${use}`)).toEqual([]);
    expect(settings(`const ax = somethingElse;\n${use}`)).toEqual([]);
    expect(settings(`const ax = 5;\n${use}`)).toEqual([]);
    expect(settings(`const ax = require("@axe-core/playwright");\n${use}`)).toEqual([
      "axe-exclude:#a",
    ]);
  });

  it("does not take an assignment of something else for a builder", () => {
    expect(settings('let b;\nb = other();\nb.exclude(["#a"]);')).toEqual([]);
  });

  it("does not take a function that has no body for a maker: it is not traced, so a disableRules on it is unreadable", () => {
    expect(unreadable('declare function make(): AxeBuilder;\nmake().disableRules(["x"]);')).toEqual(
      ["disableRules@2"],
    );
  });

  it("does not take a variable holding something that is not a function for a maker", () => {
    expect(settings('const make = 5;\nmake().exclude(["#a"]);')).toEqual([]);
    expect(settings('const make = other();\nmake().exclude(["#a"]);')).toEqual([]);
  });

  it("follows makers written in the reverse order of their use, however long the chain", () => {
    const chain = (length: number): string => {
      const lines = ["const m0 = () => new AxeBuilder({ page });"];
      for (let index = 1; index <= length; index += 1)
        lines.push(`const m${String(index)} = () => m${String(index - 1)}().withTags(["t"]);`);
      lines.reverse();
      return `${lines.join("\n")}\nm${String(length)}().exclude(["#a"]);`;
    };
    expect(settings(chain(2))).toEqual(["axe-exclude:#a"]);
    expect(settings(chain(12))).toEqual(["axe-exclude:#a"]);
  });

  it("keeps a class, a module, a builder and a maker apart even when they share a name", () => {
    expect(
      settings('import * as X from "@axe-core/playwright";\nnew X({ page }).exclude(["#a"]);'),
    ).toEqual([]);
    expect(settings('import X from "@axe-core/playwright";\nX.default.exclude(["#a"]);')).toEqual(
      [],
    );
    expect(settings('import X from "@axe-core/playwright";\nX().exclude(["#a"]);')).toEqual([]);
  });
});

describe("readAxe: a disableRules that cannot be traced is unreadable, never a zero (AXE-3)", () => {
  it("is unreadable on a receiver the reader cannot trace, with the line of the call", () => {
    expect(unreadable('linter.disableRules(["a"]);')).toEqual(["disableRules@1"]);
    expect(
      unreadable('const x = 1;\nmakeAxeBuilder().disableRules(["color-contrast"]).analyze();'),
    ).toEqual(["disableRules@2"]);
    expect(
      unreadable(
        'function f({ makeAxeBuilder }) {\n  return makeAxeBuilder(page)\n    .withTags(["a"])\n    .disableRules(["r"]);\n}',
      ),
    ).toEqual(["disableRules@4"]);
  });

  it("says it is the receiver that is untraced, not the argument", () => {
    expect(read('linter.disableRules(["a"]);').unreadable).toEqual([
      { method: "disableRules", line: 1, cause: "receiver" },
    ]);
    expect(read("new AxeBuilder({ page }).disableRules(list);").unreadable).toEqual([
      { method: "disableRules", line: 1, cause: "argument" },
    ]);
  });

  it("is also unreadable when the argument is not a literal and the receiver is not traced: one finding, the receiver's", () => {
    expect(read("linter.disableRules(list);").unreadable).toHaveLength(1);
  });

  it("leaves an untraced `.exclude(` alone: exclude is a common name, so it is read on traced builders only", () => {
    expect(read('config.exclude(["a"]);\nmakeAxeBuilder().exclude(["#a"]);')).toEqual({
      hits: [],
      unreadable: [],
    });
  });

  it("counts a traced disableRules and reports an untraced one in the same file", () => {
    const found = read('new AxeBuilder({ page }).disableRules(["a"]);\nother.disableRules(["b"]);');
    expect(found.hits.map((hit) => hit.text)).toEqual(["a"]);
    expect(found.unreadable.map((item) => item.line)).toEqual([2]);
  });
});

describe("axeFindings: the files it reads (AXE-3)", () => {
  function project(files: Readonly<Record<string, string>>): string {
    const root = resolve(import.meta.dirname, "../..");
    mkdirSync(join(root, "tmp"), { recursive: true });
    const dir = mkdtempSync(join(root, "tmp", "wt-census-axe3-"));
    made.push(dir);
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return dir;
  }

  const FIXTURE = [
    'import { test as base } from "@playwright/test";',
    'import AxeBuilder from "@axe-core/playwright";',
    "export const test = base.extend<{ makeAxeBuilder: () => AxeBuilder }>({",
    "  makeAxeBuilder: async ({ page }, use) => {",
    '    const makeAxeBuilder = () => new AxeBuilder({ page }).withTags(["wcag2a"]);',
    "    await use(makeAxeBuilder);",
    "  },",
    "});",
  ].join("\n");

  const SPEC = [
    'import { test } from "./fixtures";',
    'test("home", async ({ page, makeAxeBuilder }) => {',
    '  await makeAxeBuilder().disableRules(["color-contrast"]).analyze();',
    "});",
  ].join("\n");

  it("fails the spec of Playwright's fixture pattern, which never names the builder: a finding, not a zero", () => {
    const dir = project({ "e2e/fixtures.ts": FIXTURE, "e2e/home.spec.ts": SPEC });
    const found = axeFindings(dir, ["e2e/fixtures.ts", "e2e/home.spec.ts"]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      rule: "census-axe-unreadable",
      verdict: "fail",
      file: "e2e/home.spec.ts",
      line: 3,
    });
    expect(found[0]?.message).toBe(
      ".disableRules() is called on something that is not traced to an AxeBuilder, so what it switches off cannot be counted",
    );
  });

  it("reads a file that only calls disableRules, with no import and no AxeBuilder in it", () => {
    const dir = project({ "a.test.ts": 'helper().disableRules(["x"]);\n' });
    expect(axeFindings(dir, ["a.test.ts"])).toMatchObject([
      { rule: "census-axe-unreadable", file: "a.test.ts" },
    ]);
  });

  it("reads a file that imports an axe package under another name, and counts its settings", () => {
    const dir = project({
      "a.test.ts":
        'import Axe from "@axe-core/playwright";\nnew Axe({ page }).disableRules(["x"]);\n',
    });
    expect(axeFindings(dir, ["a.test.ts"])).toMatchObject([
      { rule: "census/axe-disable-rules", verdict: "pass", line: 2 },
    ]);
  });

  it("does not read a file that touches axe in no way, and needs no TypeScript for it", () => {
    const dir = project({ "a.ts": 'files.exclude(["a"]);\n', "b.ts": "export const b = 1;\n" });
    expect(axeFindings(dir, ["a.ts", "b.ts"])).toEqual([]);
  });

  it("counts a helper's builder across one file and fails the untraced one in the other", () => {
    const helper =
      'import AxeBuilder from "@axe-core/playwright";\nexport const make = (page) => new AxeBuilder({ page });\nmake(1).exclude(["#a"]);\n';
    const dir = project({ "h.ts": helper, "s.ts": 'make(page).disableRules(["x"]);\n' });
    const found = axeFindings(dir, ["h.ts", "s.ts"]);
    expect(found.map((item) => `${item.rule}:${item.file ?? ""}`)).toEqual([
      "census/axe-exclude:h.ts",
      "census-axe-unreadable:s.ts",
    ]);
  });
});
