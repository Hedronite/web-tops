import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coverageHints } from "./hints.ts";
import { functionCoverage } from "./functions.ts";

/** G2a: `cov(f)` is statement coverage inside the function's body, from `coverage-final.json` (WEB_TOPS.md section 6.2). */

const probe = resolve(import.meta.dirname, "../../../fixtures/probe");

function recorded(id: string): unknown {
  const value: unknown = JSON.parse(
    readFileSync(resolve(probe, id, "recorded/coverage-final.json"), "utf8"),
  );
  return value;
}

function at(line: number, column: number | null): { line: number; column: number | null } {
  return { line, column };
}

/** Five functions: `outer` holds `inner`; `empty` has no statement; `dead` never ran; `oneline` has a statement after its end. */
const SAMPLE = {
  "src/a.ts": {
    path: "src/a.ts",
    fnMap: {
      "0": {
        name: "outer",
        line: 1,
        decl: { start: at(1, 9), end: at(1, 14) },
        loc: { start: at(1, 0), end: at(10, 1) },
      },
      "1": {
        name: "inner",
        line: 3,
        decl: { start: at(3, 8), end: at(3, 13) },
        loc: { start: at(3, 2), end: at(5, 3) },
      },
      "2": {
        name: "empty",
        line: 12,
        decl: { start: at(12, 9), end: at(12, 14) },
        loc: { start: at(12, 0), end: at(12, 20) },
      },
      "3": {
        name: "dead",
        line: 14,
        decl: { start: at(14, 9), end: at(14, 13) },
        loc: { start: at(14, 0), end: at(16, null) },
      },
      "4": {
        name: "oneline",
        line: 20,
        decl: { start: at(20, 9), end: at(20, 16) },
        loc: { start: at(20, 0), end: at(20, 30) },
      },
    },
    f: { "0": 2, "1": 0, "2": 1, "3": 0, "4": 1 },
    statementMap: {
      "0": { start: at(2, 2), end: at(2, 12) },
      "1": { start: at(4, 4), end: at(4, 14) },
      "2": { start: at(6, 2), end: at(6, 12) },
      "3": { start: at(9, 2), end: at(9, 12) },
      "4": { start: at(11, 0), end: at(11, 10) },
      "5": { start: at(15, 2), end: at(15, 12) },
      "6": { start: at(20, 5), end: at(20, 25) },
      "7": { start: at(20, 40), end: at(20, 50) },
    },
    s: { "0": 1, "1": 0, "2": 1, "3": 1, "4": 1, "5": 1, "6": 1, "7": 0 },
  },
};

function row(name: string): unknown {
  return functionCoverage(SAMPLE).find((item) => item.name === name);
}

describe("G2a cov(f) is the share of statements hit inside the function's body", () => {
  it("counts the statements that start inside the span, nested functions included", () => {
    expect(row("outer")).toMatchObject({ statements: 4, covered: 3, cov: 0.75, hits: 2 });
  });

  it("is 0 when the function's own hit count is 0, whatever its statements say", () => {
    expect(row("inner")).toMatchObject({ hits: 0, statements: 1, covered: 0, cov: 0 });
    expect(row("dead")).toMatchObject({ hits: 0, statements: 1, covered: 1, cov: 0 });
  });

  it("is 1 for a function that ran and has no statement of its own", () => {
    expect(row("empty")).toMatchObject({ hits: 1, statements: 0, cov: 1 });
  });

  it("ignores a statement outside every function: module top level is not a function's coverage", () => {
    const counted = functionCoverage(SAMPLE).reduce((total, item) => total + item.statements, 0);
    expect(counted).toBe(4 + 1 + 0 + 1 + 1);
  });

  it("reports the file, the name, the line and the column of each function, in source order", () => {
    expect(
      functionCoverage(SAMPLE).map((item) => [item.file, item.name, item.line, item.column]),
    ).toEqual([
      ["src/a.ts", "outer", 1, 0],
      ["src/a.ts", "inner", 3, 2],
      ["src/a.ts", "empty", 12, 0],
      ["src/a.ts", "dead", 14, 0],
      ["src/a.ts", "oneline", 20, 0],
    ]);
  });

  it("a statement on the function's end line but past its end column is not in its body", () => {
    expect(row("oneline")).toMatchObject({ statements: 1, covered: 1, cov: 1 });
  });

  it("reads an end column of null as the end of that line", () => {
    expect(row("dead")).toMatchObject({ statements: 1 });
  });

  it("gives no rows for no coverage, and for a value that is not a coverage map", () => {
    expect(functionCoverage({})).toEqual([]);
    expect(functionCoverage(null)).toEqual([]);
    expect(functionCoverage([1, 2])).toEqual([]);
    expect(functionCoverage({ "src/a.ts": { fnMap: 3 } })).toEqual([]);
  });

  it("orders files by name", () => {
    const two = { "src/b.ts": SAMPLE["src/a.ts"], "src/a.ts": SAMPLE["src/a.ts"] };
    expect(functionCoverage(two).map((item) => item.file)).toEqual([
      ...Array<string>(5).fill("src/a.ts"),
      ...Array<string>(5).fill("src/b.ts"),
    ]);
  });
});

describe("G2a E2: the one-line arrow that nothing calls scores 0, not the line's 100 %", () => {
  it("has cov 0 from its own hit count, and its one body statement unhit", () => {
    const [arrow] = functionCoverage(recorded("e2-one-line-arrow"));
    expect(arrow).toMatchObject({
      file: "src/sign.ts",
      hits: 0,
      statements: 1,
      covered: 0,
      cov: 0,
    });
  });

  it("a called function's cov matches the statements it hit", () => {
    const rows = functionCoverage(recorded("no-coverage-survivors"));
    const discount = rows.find((item) => item.name === "discount");
    expect(discount).toMatchObject({ cov: 1 });
    expect(discount?.covered).toBe(discount?.statements);
    expect(discount?.statements).toBeGreaterThan(1);
  });

  it("a function no test runs has cov 0 in the same file", () => {
    const rows = functionCoverage(recorded("no-coverage-survivors"));
    expect(rows.find((item) => item.name === "untested")).toMatchObject({ hits: 0, cov: 0 });
  });
});

describe("G2b coverage hints are found in the source, by kind and line", () => {
  it("finds the v8, istanbul and c8 hints, once each, with their line", () => {
    const text = [
      "export function a(): void {",
      "  /* v8 ignore next 3 */",
      "  if (x) {}",
      "  /* istanbul ignore next */",
      "  // c8 ignore start",
      "}",
    ].join("\n");
    expect(coverageHints(text)).toEqual([
      { kind: "v8-ignore", line: 2 },
      { kind: "istanbul-ignore", line: 4 },
      { kind: "c8-ignore", line: 5 },
    ]);
  });

  it("finds nothing in plain code, and ignores the words in a string", () => {
    expect(coverageHints("const a = 1;\n// nothing here\n")).toEqual([]);
    expect(coverageHints("const note = 'the v8 engine';\n")).toEqual([]);
  });

  it("counts two hints on one line twice", () => {
    expect(coverageHints("/* v8 ignore next */ /* istanbul ignore next */\n")).toHaveLength(2);
  });
});

describe("G2-2 a hint is a comment: prose and strings are not hints", () => {
  it.each([
    "/* v8 ignore next */",
    "/*v8 ignore next*/",
    "// v8 ignore next",
    "//v8 ignore start",
    "/* istanbul ignore next */",
    "// c8 ignore next 2",
    "  /* c8 ignore start */",
    "const a = 1; // v8 ignore next",
  ])("%s is a hint", (text) => {
    expect(coverageHints(`${text}\n`)).toHaveLength(1);
  });

  it.each([
    [
      "a doc comment that names the hints",
      "/** Every v8, istanbul and c8 ignore hint in a source file. */",
    ],
    ["a line comment about a hint", "// the v8 ignore hint takes lines out of the profile"],
    ["a block comment that continues a sentence", "/* see the c8 ignore docs */"],
    ["a JSDoc comment, which is not a block hint comment", "/** v8 ignore next */"],
    ["a JSDoc line", " * Every v8 ignore, istanbul ignore and c8 ignore"],
    ["a string with the words", "const note = 'a v8 ignore hint';"],
    ["a string with the whole comment form", 'const text = "/* v8 ignore next */";'],
    ["a single-quoted string with a line comment", "const text = '// c8 ignore next';"],
    ["a template literal with the form", "const text = `/* istanbul ignore next */`;"],
    ["an escaped quote inside a string", 'const text = "a \\" /* v8 ignore next */ b";'],
  ])("%s is not a hint", (_label, text) => {
    expect(coverageHints(`${text}\n`)).toEqual([]);
  });

  it("finds a hint after a string on the same line", () => {
    expect(coverageHints("const a = 'x'; /* v8 ignore next */\n")).toEqual([
      { kind: "v8-ignore", line: 1 },
    ]);
  });

  it("is not fooled by an apostrophe in a comment that carries the hint", () => {
    expect(coverageHints("// don't cover this: v8 ignore next\n")).toEqual([]);
    expect(coverageHints("/* v8 ignore next */ // it's fine\n")).toEqual([
      { kind: "v8-ignore", line: 1 },
    ]);
  });
});

describe("G4 a malformed coverage entry is read around, never trusted", () => {
  const at = (line: unknown, column?: unknown): unknown => ({
    line,
    ...(column === undefined ? {} : { column }),
  });

  it("skips a function whose body is missing, not a record, or has a position that is not numeric", () => {
    const entry = {
      fnMap: {
        "0": { name: "a" },
        "1": { name: "b", loc: 3 },
        "2": { name: "c", loc: { start: at("1", 0), end: at(2, 0) } },
        "3": { name: "d", loc: { start: at(1, 0) } },
        "4": { name: "e", loc: { start: at(1, 0), end: at(2, 1) } },
      },
      f: { "0": 1, "1": 1, "2": 1, "3": 1, "4": 1 },
      statementMap: {},
      s: {},
    };
    expect(functionCoverage({ "src/a.ts": entry }).map((row) => row.name)).toEqual(["e"]);
  });

  it("reads a position with no column as column 0, and an end with no column as the end of its line", () => {
    const entry = {
      fnMap: { "0": { name: "f", loc: { start: at(1), end: at(2) } } },
      f: { "0": 1 },
      statementMap: {
        "0": { start: at(2, 99), end: at(2, 120) },
        "1": { start: at(3, 0), end: at(3, 5) },
      },
      s: { "0": 1, "1": 0 },
    };
    expect(functionCoverage({ "src/a.ts": entry })).toMatchObject([
      { name: "f", line: 1, column: 0, statements: 1, covered: 1, cov: 1 },
    ]);
  });

  it("skips a statement whose span cannot be read, and gives a function with no name a placeholder", () => {
    const entry = {
      fnMap: { "0": { loc: { start: at(1, 0), end: at(5, 1) } } },
      f: { "0": 1 },
      statementMap: { "0": { start: "x" }, "1": { start: at(2, 0), end: at(2, 4) }, "2": 7 },
      s: { "0": 1, "1": 1, "2": 1 },
    };
    expect(functionCoverage({ "src/a.ts": entry })).toMatchObject([
      { name: "(anonymous)", statements: 1, cov: 1 },
    ]);
  });
});
