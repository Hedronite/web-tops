import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ComplexityError } from "../complexity/index.ts";
import { keyMutants, keyString, SurvivorKeyError } from "./key.ts";
import type { Mutant, Position, SurvivorKey } from "./key.ts";

const PROBES = fileURLToPath(new URL("../../fixtures/probe/", import.meta.url));

const BREAK = /\r\n|[\n\r\u2028\u2029]/g;

/** Stryker's location of an offset: 1-based line, 1-based column in UTF-16 units. Written apart from key.ts. */
function positionOf(text: string, offset: number): Position {
  const before = text.slice(0, offset);
  const breaks = [...before.matchAll(BREAK)];
  const last = breaks.at(-1);
  const lineStart = last === undefined ? 0 : last.index + last[0].length;
  return { line: breaks.length + 1, column: offset - lineStart + 1 };
}

/** The mutant that replaces the `nth` appearance of `snippet` in the text. */
function mutant(
  text: string,
  snippet: string,
  mutatorName: string,
  replacement: string,
  nth = 0,
): Mutant {
  let offset = -1;
  for (let seen = 0; seen <= nth; seen += 1) offset = text.indexOf(snippet, offset + 1);
  if (offset < 0) throw new Error(`no ${snippet} in the text`);
  return {
    mutatorName,
    replacement,
    location: { start: positionOf(text, offset), end: positionOf(text, offset + snippet.length) },
  };
}

const keys = (file: string, text: string, mutants: readonly Mutant[]): SurvivorKey[] =>
  keyMutants(ts, file, text, mutants);

const CLAMP = [
  "export function clamp(n: number, low: number, high: number): number {",
  "  if (n < low) return low;",
  "  return Math.min(n, high);",
  "}",
  "",
].join("\n");

describe("a mutant's key is its six fields (WEB_TOPS.md 6.4)", () => {
  it("takes the original from the source at the location, and the function from the scored unit", () => {
    const found = keys("src/clamp.ts", CLAMP, [
      mutant(CLAMP, "n < low", "EqualityOperator", "n <= low"),
      mutant(CLAMP, "Math.min(n, high)", "MethodExpression", "Math.max(n, high)"),
    ]);
    expect(found).toEqual([
      {
        file: "src/clamp.ts",
        function: "src/clamp.ts::clamp",
        mutator: "EqualityOperator",
        original: "n < low",
        replacement: "n <= low",
        occurrence: 1,
      },
      {
        file: "src/clamp.ts",
        function: "src/clamp.ts::clamp",
        mutator: "MethodExpression",
        original: "Math.min(n, high)",
        replacement: "Math.max(n, high)",
        occurrence: 1,
      },
    ]);
  });

  it("reads the recorded Stryker locations of a real run, 1-based and end-exclusive", () => {
    const dir = join(PROBES, "assertion-free-test");
    const recorded: unknown = JSON.parse(readFileSync(join(dir, "recorded/mutation.json"), "utf8"));
    const mutants = mutantsOf(recorded, "src/total.ts");
    const found = keys("src/total.ts", readFileSync(join(dir, "src/total.ts"), "utf8"), mutants);
    const total = "src/total.ts::total";
    expect(
      found.map((key) => [
        key.function,
        key.mutator,
        key.original,
        key.replacement,
        key.occurrence,
      ]),
    ).toEqual([
      [
        total,
        "BlockStatement",
        "{\n  let sum = 0;\n  for (const x of xs) {\n    sum += x;\n  }\n  return sum;\n}",
        "{}",
        1,
      ],
      [total, "BlockStatement", "{\n    sum += x;\n  }", "{}", 1],
      [total, "AssignmentOperator", "sum += x", "sum -= x", 1],
    ]);
  });

  it("keys every mutant of every recorded probe run, uniquely, in a function of its own file", () => {
    for (const name of [
      "assertion-free-test",
      "no-coverage-survivors",
      "stryker-disable",
      "test-only-diff",
    ]) {
      const dir = join(PROBES, name);
      const recorded: unknown = JSON.parse(
        readFileSync(join(dir, "recorded/mutation.json"), "utf8"),
      );
      for (const file of filesOf(recorded)) {
        const text = readFileSync(join(dir, file), "utf8");
        const found = keys(file, text, mutantsOf(recorded, file));
        expect(found.length, `${name} ${file}`).toBeGreaterThan(0);
        expect(new Set(found.map(keyString)).size, `${name} ${file}`).toBe(found.length);
        for (const key of found)
          expect(key.function.startsWith(`${file}::`), key.function).toBe(true);
      }
    }
  });
});

describe("the function is the scored unit the mutant is written in", () => {
  const source = [
    "export function run(items: number[]): number {", // 1
    "  const keep = items.filter((x) => {", // 2
    "    return x > 1;", // 3
    "  });", // 4
    "  function inner(y: number): boolean { return y < 0; }", // 5
    "  return keep.length;", // 6
    "}", // 7
    "export class Box {", // 8
    "  size(a: number): boolean { return a < 1; }", // 9
    "  field = (b: number): boolean => b < 2;", // 10
    "}", // 11
    "export const top = 1 < 2;", // 12
    "",
  ].join("\n");

  const at = (snippet: string): string => {
    const found = keys("src/a.ts", source, [mutant(source, snippet, "EqualityOperator", "x")]);
    return found[0]?.function ?? "";
  };

  it("counts a callback's mutant for the function that holds it, and so a nested function's", () => {
    expect(at("x > 1")).toBe("src/a.ts::run");
    expect(at("y < 0")).toBe("src/a.ts::run");
  });

  it("names a class member, and a function-valued field", () => {
    expect(at("a < 1")).toBe("src/a.ts::Box.size");
    expect(at("b < 2")).toBe("src/a.ts::Box.field");
  });

  it("names module code `<module>`", () => {
    expect(at("1 < 2")).toBe("src/a.ts::<module>");
  });

  it("gives a multi-line block mutant the function whose body it is", () => {
    const block = "{\n    return x > 1;\n  }";
    const found = keys("src/a.ts", source, [mutant(source, block, "BlockStatement", "{}")]);
    expect(found[0]).toMatchObject({ function: "src/a.ts::run", original: block });
  });
});

describe("the occurrence counts the same mutation within a function, in source order", () => {
  const source = [
    "export function both(a: number): boolean {",
    "  const x = a < 1;",
    "  const y = a < 1;",
    "  return x && y;",
    "}",
    "export function other(a: number): boolean { return a < 1; }",
    "",
  ].join("\n");
  const less = (nth: number): Mutant => mutant(source, "a < 1", "EqualityOperator", "a <= 1", nth);

  it("numbers identical mutants 1, 2 in a function, and restarts in the next", () => {
    const found = keys("src/b.ts", source, [less(0), less(1), less(2)]);
    expect(found.map((key) => [key.function, key.occurrence])).toEqual([
      ["src/b.ts::both", 1],
      ["src/b.ts::both", 2],
      ["src/b.ts::other", 1],
    ]);
  });

  it("goes by source order, not the order the mutants arrive in, and answers in the order given", () => {
    const found = keys("src/b.ts", source, [less(1), less(0)]);
    expect(found.map((key) => key.occurrence)).toEqual([2, 1]);
  });

  it("does not count a different replacement or a different mutator as the same mutation", () => {
    const found = keys("src/b.ts", source, [
      less(0),
      mutant(source, "a < 1", "EqualityOperator", "a >= 1", 1),
      mutant(source, "a < 1", "ConditionalExpression", "a <= 1", 0),
    ]);
    expect(found.map((key) => key.occurrence)).toEqual([1, 1, 1]);
  });

  it("counts a mutant that was killed or ignored as well as a survivor, so a neighbour does not move it", () => {
    const all = keys("src/b.ts", source, [less(0), less(1)]);
    const survivorOnly = keys("src/b.ts", source, [less(1)]);
    expect(all[1]?.occurrence).toBe(2);
    expect(survivorOnly[0]?.occurrence).toBe(1);
  });
});

describe("a moved line keeps its key, and the limits are written down", () => {
  const strip = (found: readonly SurvivorKey[]): string[] => found.map(keyString);
  const all = (text: string): Mutant[] => [
    mutant(text, "n < low", "EqualityOperator", "n <= low"),
    mutant(text, "n < low", "ConditionalExpression", "true"),
    mutant(text, "Math.min(n, high)", "MethodExpression", "Math.max(n, high)"),
  ];
  const base = strip(keys("src/clamp.ts", CLAMP, all(CLAMP)));

  it("is unchanged by lines added above it: comments, blank lines, an import", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom("// note", "", 'import "node:fs";', "/** doc */"),
        (count, line) => {
          const text = `${Array.from({ length: count }, () => line).join("\n")}\n${CLAMP}`;
          expect(strip(keys("src/clamp.ts", text, all(text)))).toEqual(base);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("is unchanged by CRLF line breaks", () => {
    const text = CLAMP.replaceAll("\n", "\r\n");
    expect(strip(keys("src/clamp.ts", text, all(text)))).toEqual(base);
  });

  it("is unchanged by a wide character earlier on the same line (columns are UTF-16 units)", () => {
    const text = CLAMP.replace("  if (n < low)", '  const note = "😀"; if (n < low)');
    const found = keys("src/clamp.ts", text, [
      mutant(text, "n < low", "EqualityOperator", "n <= low"),
    ]);
    expect(found[0]?.original).toBe("n < low");
  });

  it("changes when the function is renamed, when the original changes, or in another file", () => {
    const renamed = CLAMP.replace("clamp", "limit");
    expect(keys("src/clamp.ts", renamed, all(renamed))[0]?.function).toBe("src/clamp.ts::limit");
    const edited = CLAMP.replace("n < low", "n < (low)");
    const found = keys("src/clamp.ts", edited, [
      mutant(edited, "n < (low)", "EqualityOperator", "n <= low"),
    ]);
    expect(found.map(keyString)[0]).not.toBe(base[0]);
    expect(keys("src/other.ts", CLAMP, all(CLAMP))[0]?.function).toBe("src/other.ts::clamp");
  });

  it("shifts the occurrence of a mutation when an identical one is added earlier in the same function", () => {
    const before = ["export function f(a: number) {", "  return a < 1;", "}", ""].join("\n");
    const after = [
      "export function f(a: number) {",
      "  const early = a < 1;",
      "  return a < 1;",
      "}",
      "",
    ].join("\n");
    const original = keys("x.ts", before, [mutant(before, "a < 1", "EqualityOperator", "a <= 1")]);
    const shifted = keys("x.ts", after, [
      mutant(after, "a < 1", "EqualityOperator", "a <= 1", 0),
      mutant(after, "a < 1", "EqualityOperator", "a <= 1", 1),
    ]);
    expect(original[0]?.occurrence).toBe(1);
    expect(shifted.map((key) => key.occurrence)).toEqual([1, 2]);
  });
});

describe("a location that is not in the file is refused", () => {
  const at = (start: Position, end: Position): Mutant => ({
    mutatorName: "EqualityOperator",
    replacement: "x",
    location: { start, end },
  });

  it.each([
    ["line 0", { line: 0, column: 1 }, { line: 1, column: 2 }],
    ["column 0", { line: 1, column: 0 }, { line: 1, column: 2 }],
    ["a line past the end", { line: 99, column: 1 }, { line: 99, column: 2 }],
    ["a column past the line", { line: 1, column: 500 }, { line: 1, column: 501 }],
    ["an end before the start", { line: 2, column: 5 }, { line: 2, column: 3 }],
  ])("%s", (_name, start, end) => {
    expect(() => keys("src/clamp.ts", CLAMP, [at(start, end)])).toThrow(SurvivorKeyError);
    expect(() => keys("src/clamp.ts", CLAMP, [at(start, end)])).toThrow("src/clamp.ts");
  });

  it("keeps the original exactly as written, spaces at its edges included", () => {
    const text = "export const a = (1 < 2);";
    const found = keys("src/a.ts", text, [mutant(text, " < ", "EqualityOperator", " <= ")]);
    expect(found[0]?.original).toBe(" < ");
  });

  it("lets a mutant end at the very end of the file", () => {
    const text = "export const a = 1 < 2";
    const found = keys("src/a.ts", text, [mutant(text, "1 < 2", "EqualityOperator", "1 <= 2")]);
    expect(found[0]?.original).toBe("1 < 2");
  });

  it("passes a file that does not parse on as a ComplexityError", () => {
    expect(() => keys("src/a.ts", "function (", [])).toThrow(ComplexityError);
  });

  it("keys nothing for no mutants", () => {
    expect(keys("src/clamp.ts", CLAMP, [])).toEqual([]);
  });
});

describe("keyString", () => {
  const key: SurvivorKey = {
    file: "a.ts",
    function: "a.ts::f",
    mutator: "M",
    original: "x",
    replacement: "y",
    occurrence: 1,
  };

  it("is equal for equal keys and different when any one of the six fields differs", () => {
    expect(keyString({ ...key })).toBe(keyString(key));
    const changes: Partial<SurvivorKey>[] = [
      { file: "b.ts" },
      { function: "a.ts::g" },
      { mutator: "N" },
      { original: "z" },
      { replacement: "w" },
      { occurrence: 2 },
    ];
    for (const change of changes) expect(keyString({ ...key, ...change })).not.toBe(keyString(key));
  });

  it("cannot be confused by a field that holds a separator", () => {
    const a = keyString({ ...key, original: 'x","y' });
    const b = keyString({ ...key, original: "x", replacement: "y" });
    expect(a).not.toBe(b);
  });
});

const read = (from: unknown, key: string): unknown =>
  typeof from === "object" && from !== null ? Reflect.get(from, key) : undefined;

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The files a Stryker report names. */
function filesOf(report: unknown): string[] {
  const files = read(report, "files");
  return typeof files === "object" && files !== null ? Object.keys(files) : [];
}

function position(from: unknown): Position {
  const line = read(from, "line");
  const column = read(from, "column");
  if (typeof line !== "number" || typeof column !== "number") throw new Error("bad position");
  return { line, column };
}

function toMutant(raw: unknown): Mutant {
  const mutatorName = read(raw, "mutatorName");
  const replacement = read(raw, "replacement");
  if (typeof mutatorName !== "string" || typeof replacement !== "string")
    throw new Error("bad mutant");
  const location = read(raw, "location");
  return {
    mutatorName,
    replacement,
    location: { start: position(read(location, "start")), end: position(read(location, "end")) },
  };
}

/** The mutants of one file in a recorded Stryker report. */
const mutantsOf = (report: unknown, file: string): Mutant[] =>
  listOf(read(read(read(report, "files"), file), "mutants")).map(toMutant);
