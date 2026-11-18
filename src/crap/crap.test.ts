import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTypeScript } from "../complexity/index.ts";
import { crapOf } from "./formula.ts";
import { scoreFile } from "./score.ts";
import { changedRanges, touched } from "./scope.ts";

/** G4a: CRAP(f) = comp(f)^2 * (1 - cov(f))^3 + comp(f), from the counter's complexity and the statement cov(f) (WEB_TOPS.md section 6.2). */

const root = resolve(import.meta.dirname, "../..");
const ts = loadTypeScript(root);
const OPTIONS = { nullishDiscount: true };

function span(line: number, column: number, endLine: number, endColumn: number | null): unknown {
  return { start: { line, column }, end: { line: endLine, column: endColumn } };
}

/** A coverage map for one function and its statements, in `coverage-final.json`'s shape. */
function coverageOf(
  functions: readonly { name: string; loc: unknown; hits: number }[],
  statements: readonly { at: unknown; hits: number }[],
): unknown {
  return {
    fnMap: Object.fromEntries(
      functions.map((fn, index) => [String(index), { name: fn.name, loc: fn.loc }]),
    ),
    f: Object.fromEntries(functions.map((fn, index) => [String(index), fn.hits])),
    statementMap: Object.fromEntries(statements.map((item, index) => [String(index), item.at])),
    s: Object.fromEntries(statements.map((item, index) => [String(index), item.hits])),
  };
}

function rowsOf(
  text: string,
  coverage: unknown,
): { key: string; complexity: number; coverage: number; crap: number }[] {
  return scoreFile({ ts, file: "src/a.ts", text, coverage, options: OPTIONS }).map((row) => ({
    key: row.key,
    complexity: row.complexity,
    coverage: row.coverage,
    crap: row.crap,
  }));
}

describe("G4a the CRAP formula", () => {
  it.each([
    [4, 0, 20],
    [4, 1, 4],
    [1, 1, 1],
    [1, 0, 2],
    [3, 0.5, 4.125],
    [2, 0, 6],
    [8, 0.75, 8 + (64 * 1) / 64],
  ])("complexity %d at coverage %d is %d", (complexity, cov, expected) => {
    expect(crapOf(complexity, cov)).toBeCloseTo(expected, 10);
  });

  it("is the line reading's 4 for the E2 arrow, and 20 once the function's hit count is 0", () => {
    expect(crapOf(4, 1)).toBe(4);
    expect(crapOf(4, 0)).toBe(20);
  });
});

describe("G4a E2: the one-line arrow that nothing calls scores 20, not 4", () => {
  const dir = resolve(root, "fixtures/probe/e2-one-line-arrow");
  const text = readFileSync(resolve(dir, "src/sign.ts"), "utf8");
  const recorded: unknown = JSON.parse(
    readFileSync(resolve(dir, "recorded/coverage-final.json"), "utf8"),
  );
  const entry: unknown = Reflect.get(Object(recorded), "src/sign.ts");

  it("has complexity 4, coverage 0 and CRAP 20", () => {
    const [row] = scoreFile({ ts, file: "src/sign.ts", text, coverage: entry, options: OPTIONS });
    expect(row).toMatchObject({ key: "src/sign.ts::sign", complexity: 4, coverage: 0, crap: 20 });
  });

  it("would have scored 4 on the line reading of the same function", () => {
    expect(crapOf(4, 1)).toBe(4);
  });
});

const TEXT = [
  "export function pick(a: number, b: number): number {", // 1
  "  if (a > 0 && b > 0) {", // 2
  "    return a;", // 3
  "  }", // 4
  "  return b;", // 5
  "}", // 6
  "",
].join("\n");

describe("G4a CRAP joins the counter's unit with the coverage function it contains", () => {
  const pick = { name: "pick", loc: span(1, 0, 6, 1), hits: 3 };
  const body = (hits: readonly number[]): { at: unknown; hits: number }[] => [
    { at: span(2, 2, 2, 24), hits: hits[0] ?? 0 },
    { at: span(3, 4, 3, 13), hits: hits[1] ?? 0 },
    { at: span(5, 2, 5, 11), hits: hits[2] ?? 0 },
  ];

  it("scores a function from its complexity and the share of its statements hit", () => {
    const [row] = rowsOf(TEXT, coverageOf([pick], body([1, 0, 1])));
    expect(row).toMatchObject({ key: "src/a.ts::pick", complexity: 3 });
    expect(row?.coverage).toBeCloseTo(2 / 3, 10);
    expect(row?.crap).toBeCloseTo(crapOf(3, 2 / 3), 10);
  });

  it("scores a fully covered function at its complexity", () => {
    const [row] = rowsOf(TEXT, coverageOf([pick], body([1, 1, 1])));
    expect(row).toMatchObject({ complexity: 3, coverage: 1, crap: 3 });
  });

  it("scores a function that never ran at cov 0, whatever its statements say", () => {
    const [row] = rowsOf(TEXT, coverageOf([{ ...pick, hits: 0 }], body([1, 1, 1])));
    expect(row).toMatchObject({ coverage: 0, crap: crapOf(3, 0) });
  });

  it("scores a file the coverage run never reported at cov 0", () => {
    const [row] = rowsOf(TEXT, undefined);
    expect(row).toMatchObject({ complexity: 3, coverage: 0, crap: crapOf(3, 0) });
  });

  it("scores cov 0 when the coverage entry cannot be read", () => {
    const [row] = rowsOf(TEXT, { fnMap: 3 });
    expect(row).toMatchObject({ coverage: 0 });
  });
});

describe("G4a nested functions fold into the unit that holds them, and a class member is its own unit", () => {
  const FOLDED = [
    "export function outer(items: number[]): number[] {", // 1
    "  return items.filter((x) => x > 0 && x < 9).map((x) => (x > 4 ? x : 0));", // 2
    "}", // 3
    "",
  ].join("\n");

  it("counts the callbacks' branches in the unit and reads its coverage over the whole body", () => {
    const coverage = coverageOf(
      [
        { name: "outer", loc: span(1, 0, 3, 1), hits: 1 },
        { name: "(anonymous_1)", loc: span(2, 24, 2, 44), hits: 4 },
        { name: "(anonymous_2)", loc: span(2, 51, 2, 70), hits: 0 },
      ],
      [
        { at: span(2, 2, 2, 70), hits: 1 },
        { at: span(2, 30, 2, 43), hits: 1 },
        { at: span(2, 57, 2, 69), hits: 0 },
      ],
    );
    const rows = rowsOf(FOLDED, coverage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "src/a.ts::outer", complexity: 3 });
    expect(rows[0]?.coverage).toBeCloseTo(2 / 3, 10);
  });

  it("scores each method of a class on its own", () => {
    const text = [
      "export class Box {", // 1
      "  open(a: number): number {", // 2
      "    return a > 0 ? a : 0;", // 3
      "  }", // 4
      "  close(): number {", // 5
      "    return 1;", // 6
      "  }", // 7
      "}", // 8
      "",
    ].join("\n");
    const coverage = coverageOf(
      [
        { name: "open", loc: span(2, 27, 4, 3), hits: 1 },
        { name: "close", loc: span(5, 19, 7, 3), hits: 0 },
      ],
      [
        { at: span(3, 4, 3, 25), hits: 1 },
        { at: span(6, 4, 6, 13), hits: 0 },
      ],
    );
    expect(rowsOf(text, coverage).map((row) => [row.key, row.complexity, row.coverage])).toEqual([
      ["src/a.ts::Box.open", 2, 1],
      ["src/a.ts::Box.close", 1, 0],
    ]);
  });
});

describe("G4a code outside every function is scored as <module> only when it has a branch", () => {
  it("has no row for plain module code, and a row for module code that branches", () => {
    expect(rowsOf("export const a = 1;\n", undefined)).toEqual([]);
    const text = "export const a = process.argv.length > 2 ? 1 : 2;\n";
    const coverage = coverageOf([], [{ at: span(1, 0, 1, 50), hits: 1 }]);
    expect(rowsOf(text, coverage)).toEqual([
      { key: "src/a.ts::<module>", complexity: 2, coverage: 1, crap: 2 },
    ]);
  });

  it("reads the module's coverage from the statements outside every function", () => {
    const text = [
      "export const a = process.argv.length > 2 ? 1 : 2;", // 1
      "export function f(): number {", // 2
      "  return 1;", // 3
      "}", // 4
      "",
    ].join("\n");
    const coverage = coverageOf(
      [{ name: "f", loc: span(2, 29, 4, 1), hits: 0 }],
      [
        { at: span(1, 0, 1, 50), hits: 1 },
        { at: span(3, 2, 3, 11), hits: 0 },
      ],
    );
    const module = rowsOf(text, coverage).find((row) => row.key.endsWith("<module>"));
    expect(module).toMatchObject({ coverage: 1 });
  });
});

describe("G4b a row is in the diff's scope when a changed line falls inside the function", () => {
  const rows = scoreFile({
    ts,
    file: "src/a.ts",
    text: [
      "export function one(a: number): number {", // 1
      "  return a > 0 ? a : 0;", // 2
      "}", // 3
      "export function two(a: number): number {", // 4
      "  return a > 1 ? a : 1;", // 5
      "}", // 6
      "",
    ].join("\n"),
    coverage: undefined,
    options: OPTIONS,
  });

  it("keeps the function a changed line touches, and drops the one it does not", () => {
    const kept = touched(rows, new Map([["src/a.ts", [{ start: 5, end: 5 }]]]));
    expect(kept.map((row) => row.key)).toEqual(["src/a.ts::two"]);
  });

  it("touches a function by its first line, its last line, or a range across it", () => {
    for (const range of [
      { start: 1, end: 1 },
      { start: 3, end: 3 },
      { start: 3, end: 4 },
      { start: 0, end: 9 },
    ]) {
      expect(
        touched(rows, new Map([["src/a.ts", [range]]])).length,
        JSON.stringify(range),
      ).toBeGreaterThan(0);
    }
  });

  it("keeps nothing for a file the diff does not name, or for no changed lines", () => {
    expect(touched(rows, new Map([["src/other.ts", [{ start: 1, end: 9 }]]]))).toEqual([]);
    expect(touched(rows, new Map())).toEqual([]);
  });
});

describe("G4-2 a changed <module> judges the module row alone, and a changed function not the module row", () => {
  const text = [
    "export const top = process.argv.length > 2 ? 1 : 2;", // 1
    "export function one(a: number): number {", // 2
    "  return a > 0 ? a : 0;", // 3
    "}", // 4
    "",
  ].join("\n");
  const rows = scoreFile({ ts, file: "src/a.ts", text, coverage: undefined, options: OPTIONS });
  const scopeOf = (key: string, start: number, end: number): ReturnType<typeof changedRanges> =>
    changedRanges({
      mergeBase: "x",
      files: [],
      changedFunctions: [{ key, path: "src/a.ts", start, end }],
      testFiles: [],
      coveredFunctions: [],
      mutate: [],
    });

  it("has a module row and a function row to tell apart", () => {
    expect(rows.map((row) => row.name)).toEqual(["<module>", "one"]);
  });

  it("keeps only the <module> row when the changed function is <module>, whose span is the whole file", () => {
    expect(touched(rows, scopeOf("src/a.ts::<module>", 1, 4)).map((row) => row.name)).toEqual([
      "<module>",
    ]);
  });

  it("keeps the function, and not the <module> row, when the changed function is a function", () => {
    expect(touched(rows, scopeOf("src/a.ts::one", 2, 4)).map((row) => row.name)).toEqual(["one"]);
  });

  it("keeps both when the diff changed both", () => {
    const both = new Map([
      [
        "src/a.ts",
        [
          { start: 1, end: 4, module: true },
          { start: 2, end: 4 },
        ],
      ],
    ]);
    expect(touched(rows, both).map((row) => row.name)).toEqual(["<module>", "one"]);
  });
});

describe("G4b the ranges a diff scope gives are its changed functions' spans, by file", () => {
  it("groups the changed functions by path, and gives none for a scope with none", () => {
    const scope = {
      mergeBase: "x",
      files: [],
      changedFunctions: [
        { key: "src/a.ts::f", path: "src/a.ts", start: 3, end: 9 },
        { key: "src/a.ts::g", path: "src/a.ts", start: 12, end: 14 },
        { key: "src/b.ts::h", path: "src/b.ts", start: 1, end: 2 },
      ],
      testFiles: ["src/a.test.ts"],
      coveredFunctions: [{ key: "src/c.ts::k", path: "src/c.ts", start: 1, end: 5 }],
      mutate: [],
    };
    expect(changedRanges(scope)).toEqual(
      new Map([
        [
          "src/a.ts",
          [
            { start: 3, end: 9 },
            { start: 12, end: 14 },
          ],
        ],
        ["src/b.ts", [{ start: 1, end: 2 }]],
      ]),
    );
    expect(changedRanges({ ...scope, changedFunctions: [] })).toEqual(new Map());
  });
});
