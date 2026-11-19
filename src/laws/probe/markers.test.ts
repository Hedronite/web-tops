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
        "a; // expect:\nb; // expect: ,\nc; // expects: r\nd; /* expect: r */\n",
      ),
    ).toEqual([]);
  });

  it("a file with no marker has no expectation", () => {
    expect(parseMarkers("f.ts", "export const a = 1;\n")).toEqual([]);
    expect(parseMarkers("f.ts", "")).toEqual([]);
  });
});
