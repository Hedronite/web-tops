import { describe, expect, it } from "vitest";
import { directivesIn, readsDirectives } from "./directives.ts";

const kinds = (file: string, text: string): string[] =>
  directivesIn(file, text).map((found) => `${found.kind}@${String(found.line)}`);

describe("directivesIn: the comment forms of each kind (WEB_TOPS.md 6.7)", () => {
  it.each([
    ["a block disable", "/* eslint-disable no-console */", "eslint-disable@1"],
    ["a next-line disable", "// eslint-disable-next-line no-alert -- why", "eslint-disable@1"],
    ["a line disable", "x(); // eslint-disable-line no-restricted-globals", "eslint-disable@1"],
    ["a disable with no rule", "/* eslint-disable */", "eslint-disable@1"],
    ["a disable without spaces", "/*eslint-disable*/", "eslint-disable@1"],
    ["@ts-expect-error", "// @ts-expect-error: why", "ts-expect-error@1"],
    ["@ts-ignore", "// @ts-ignore", "ts-ignore@1"],
    ["@ts-nocheck", "// @ts-nocheck", "ts-nocheck@1"],
    ["a block @ts-ignore", "/* @ts-ignore */", "ts-ignore@1"],
    ["biome-ignore", "// biome-ignore lint/suspicious/noExplicitAny: legacy", "biome-ignore@1"],
    ["biome-ignore-all", "// biome-ignore-all lint: generated", "biome-ignore@1"],
    ["Stryker disable", "// Stryker disable next-line all: why", "stryker-disable@1"],
    ["Stryker disable in a block", "/* Stryker disable all */", "stryker-disable@1"],
  ])("counts %s in a TypeScript file", (_name, source, expected) => {
    expect(kinds("a.ts", `\n${source}\n`).map((found) => found.replace("@1", "@2"))).toEqual([
      expected.replace("@1", "@2"),
    ]);
  });

  it.each([
    ["an enable", "/* eslint-enable no-console */"],
    ["a restore", "// Stryker restore all"],
    ["biome-ignore-end", "// biome-ignore-end lint"],
    ["prose that mentions a directive", "// we use eslint-disable sparingly"],
    ["a directive after prose", "// note: @ts-ignore is banned"],
    ["a longer word", "// eslint-disabled things"],
    ["a different tool", "// tslint:disable"],
    ["the coverage hints, which are not this reader's", "/* v8 ignore next */"],
  ])("does not count %s", (_name, source) => {
    expect(kinds("a.ts", source)).toEqual([]);
  });

  it("does not count a directive written in a string, a template literal or a regular expression", () => {
    const source = [
      'const a = "// eslint-disable";',
      "const b = `// @ts-ignore`;",
      "const c = /\\/\\/ @ts-nocheck/;",
      "const d = '/* Stryker disable */';",
    ].join("\n");
    expect(kinds("a.ts", source)).toEqual([]);
  });

  it("counts each directive once, however many rules it names, and reports its line", () => {
    const source = "/* eslint-disable a, b, c */\nx();\n// eslint-disable-next-line d\ny();\n";
    expect(kinds("a.ts", source)).toEqual(["eslint-disable@1", "eslint-disable@3"]);
  });

  it("counts every extension the scripts use", () => {
    for (const name of [
      "a.js",
      "a.jsx",
      "a.mjs",
      "a.cjs",
      "a.ts",
      "a.tsx",
      "a.mts",
      "a.cts",
      "A.TS",
    ]) {
      expect(kinds(name, "// @ts-ignore"), name).toEqual(["ts-ignore@1"]);
    }
  });

  it("counts a directive in JSX text of a .tsx only where it is a comment", () => {
    expect(kinds("a.tsx", "const a = <p>{/* eslint-disable-next-line x */}</p>;")).toEqual([
      "eslint-disable@1",
    ]);
  });
});

describe("directivesIn: stylesheets", () => {
  it.each([
    [
      "a.css",
      "/* stylelint-disable-next-line color-no-invalid-hex */\n.b {}\n",
      "stylelint-disable@1",
    ],
    ["a.css", ".b {}\n/* stylelint-disable */", "stylelint-disable@2"],
    ["a.pcss", "/* stylelint-disable-line */", "stylelint-disable@1"],
    ["a.scss", "// stylelint-disable-next-line x", "stylelint-disable@1"],
    ["a.less", "/* stylelint-disable */", "stylelint-disable@1"],
  ])("counts a directive in %s", (file, source, expected) => {
    expect(kinds(file, source)).toEqual([expected]);
  });

  it("does not count `//` in a .css file, an enable, or a string", () => {
    expect(
      kinds(
        "a.css",
        "// stylelint-disable\n/* stylelint-enable */\na::after { content: '/* stylelint-disable */'; }",
      ),
    ).toEqual([]);
  });
});

describe("directivesIn: HTML", () => {
  it("counts an html-validate directive comment, in each form, with its line", () => {
    const source = [
      "<!doctype html>",
      "<!-- [html-validate-disable-next no-inline-style: reason] -->",
      "<p style='x'>a</p>",
      "<!-- [html-validate-disable-block element-name] -->",
      "<!-- [html-validate-disable] -->",
    ].join("\n");
    expect(kinds("a.html", source)).toEqual([
      "html-validate-disable@2",
      "html-validate-disable@4",
      "html-validate-disable@5",
    ]);
  });

  it("does not count an html-validate enable, or text that only mentions the directive", () => {
    expect(
      kinds("a.html", "<!-- [html-validate-enable] -->\n<!-- see html-validate-disable -->"),
    ).toEqual([]);
  });

  it("counts eslint and stylelint directives in an HTML comment, and a stylelint one in a <style> block", () => {
    const source =
      "<!-- eslint-disable -->\n<style>\n/* stylelint-disable-next-line x */\na {}\n</style>\n";
    expect(kinds("a.htm", source)).toEqual(["eslint-disable@1", "stylelint-disable@3"]);
  });
});

describe("directivesIn: Astro", () => {
  const SOURCE = [
    "---",
    "// @ts-expect-error: the prop is untyped",
    "const a: number = 'x';",
    "const s = '// eslint-disable';",
    "---",
    "<!-- eslint-disable-next-line astro/no-unused-define-vars-in-style -->",
    "<p>{a}</p>",
    "<!-- [html-validate-disable] -->",
    "<style>",
    "  /* stylelint-disable-next-line color-no-invalid-hex */",
    "  p { color: #ggg; }",
    "</style>",
    "<script>",
    "  // eslint-disable-next-line no-console",
    "  console.log(1);",
    "</script>",
  ].join("\n");

  it("counts the frontmatter and script as TypeScript, the template as markup, and the style as CSS", () => {
    expect(kinds("a.astro", SOURCE)).toEqual([
      "ts-expect-error@2",
      "eslint-disable@14",
      "eslint-disable@6",
      "stylelint-disable@10",
    ]);
  });

  it("leaves an html-validate comment alone in a source template, which html-validate never reads", () => {
    expect(kinds("a.astro", SOURCE).some((found) => found.startsWith("html-validate"))).toBe(false);
  });

  it("reads what it can of an Astro file whose frontmatter is never closed", () => {
    expect(kinds("a.astro", "---\nconst a = 1;\n<!-- eslint-disable -->\n<p></p>")).toEqual([
      "eslint-disable@3",
    ]);
  });

  it("does not read a markup comment written in a string of the frontmatter or a script", () => {
    const source = [
      "---",
      'const a = "<!-- eslint-disable -->";',
      "---",
      "<script>",
      '  const b = "<!-- stylelint-disable -->";',
      "</script>",
      "<p/>",
    ].join("\n");
    expect(kinds("a.astro", source)).toEqual([]);
  });

  it("counts nothing in an Astro file with no comment", () => {
    expect(kinds("a.astro", "<p>hello</p>")).toEqual([]);
  });

  it("keeps lines right when the file has a wide character before the template", () => {
    expect(kinds("a.astro", "---\nconst a = '😀';\n---\n<!-- eslint-disable -->\n<p/>")).toEqual([
      "eslint-disable@4",
    ]);
  });
});

describe("readsDirectives", () => {
  it.each([
    ["a.ts", true],
    ["a.css", true],
    ["a.scss", true],
    ["a.html", true],
    ["a.astro", true],
    ["a.md", false],
    ["a.json", false],
    ["README", false],
  ])("%s is %s", (file, expected) => {
    expect(readsDirectives(file)).toBe(expected);
  });
});
