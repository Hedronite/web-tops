import { describe, expect, it } from "vitest";
import { parseMarkers } from "./markers.ts";

describe("G3a markers: `// expect: <rule>` names what a line must report", () => {
  it("reads one rule at the end of a line, on that line", () => {
    const text = "const a: any = 1; // expect: no-explicit-any\nconst b = 2;\n";
    expect(parseMarkers("W-01/bad/a.ts", text)).toEqual([
      { file: "W-01/bad/a.ts", line: 1, rules: ["no-explicit-any"] },
    ]);
  });

  it("reads several rules, comma-separated, trimming blanks and dropping empty names", () => {
    const text = "x(); // expect:  one ,two,, three \n";
    expect(parseMarkers("f.ts", text)[0]?.rules).toEqual(["one", "two", "three"]);
  });

  it("a comment that stands alone is about the next line, for a directive that cannot carry one", () => {
    const text = "// expect: ban-ts-comment\n// @ts-expect-error\nconst a = 1;\n";
    expect(parseMarkers("f.ts", text)).toEqual([
      { file: "f.ts", line: 2, rules: ["ban-ts-comment"] },
    ]);
  });

  it("an indented comment alone on its line is about the next line too", () => {
    expect(parseMarkers("f.ts", "  // expect: r\n  x();\n")).toEqual([
      { file: "f.ts", line: 2, rules: ["r"] },
    ]);
  });

  it("counts lines from one, and finds each marker in a file of several", () => {
    const text = "a;\nb; // expect: r1\nc;\nd; // expect: r2, r3\n";
    expect(parseMarkers("f.ts", text).map((found) => [found.line, found.rules])).toEqual([
      [2, ["r1"]],
      [4, ["r2", "r3"]],
    ]);
  });

  it("ignores a comment that names no rule, and text that only looks like a marker", () => {
    expect(
      parseMarkers(
        "f.ts",
        "a; // expect:\nb; // expect: ,\nc; // expects: r\nd; /* expects: r */\n",
      ),
    ).toEqual([]);
  });

  it("reads a marker in a block comment, for a CSS twin, without its closing", () => {
    const text =
      ".a { colour: red; } /* expect: property-no-unknown */\n/* expect: r1, r2 */\n.b {}\n";
    expect(parseMarkers("f.css", text)).toEqual([
      { file: "f.css", line: 1, rules: ["property-no-unknown"] },
      { file: "f.css", line: 3, rules: ["r1", "r2"] },
    ]);
  });

  it("reads a marker in an HTML comment, for an Astro template, alone on its line or after the markup", () => {
    const text =
      '---\nconst a = 1;\n---\n<!-- expect: alt-text -->\n<img src="a.png" />\n<a href="#">go</a> <!-- expect: anchor-is-valid, r2 -->\n';
    expect(parseMarkers("W-22/bad/page.astro", text)).toEqual([
      { file: "W-22/bad/page.astro", line: 5, rules: ["alt-text"] },
      { file: "W-22/bad/page.astro", line: 6, rules: ["anchor-is-valid", "r2"] },
    ]);
  });

  it("reads a line marker in an Astro frontmatter as in any script, and not one it only looks like", () => {
    const text =
      "---\nconst a: any = 1; // expect: no-explicit-any\n// expect: ban-ts-comment\n// @ts-expect-error\n---\n<!-- expects: r -->\n<!-- expect: -->\n/* expect: */\n";
    expect(parseMarkers("page.astro", text)).toEqual([
      { file: "page.astro", line: 2, rules: ["no-explicit-any"] },
      { file: "page.astro", line: 4, rules: ["ban-ts-comment"] },
    ]);
  });

  it("a file with no marker has no expectation", () => {
    expect(parseMarkers("f.ts", "export const a = 1;\n")).toEqual([]);
    expect(parseMarkers("f.ts", "")).toEqual([]);
  });
});

describe("G3a markers: the shape of a marker", () => {
  it("reads a rule that follows the colon with no space, and one after any number of spaces", () => {
    expect(parseMarkers("f.ts", "x(); // expect:rule\n")[0]?.rules).toEqual(["rule"]);
    expect(parseMarkers("f.ts", "x(); // expect:     rule\n")[0]?.rules).toEqual(["rule"]);
  });
});
