import { describe, expect, it } from "vitest";
import { functionsIn, innermostAt } from "./functions.ts";

const SOURCE = [
  "export function outer() {", //  1
  "  function inner() {}", //      2
  "  return [1].map((x) => x);", // 3
  "}", //                          4
  "const f = () => 1;", //        5
  "export class C {", //          6
  "  constructor() {}", //        7
  "  m() {}", //                  8
  "  get g() { return 1; }", //   9
  "  static s = () => 2;", //    10
  "}", //                         11
  "const o = { p() {}, q: () => 3 };", // 12
  "setTimeout(() => {}, 1);", //  13
  "setTimeout(function () {}, 2);", // 14
].join("\n");

describe("G6a: functions are keyed by file, container chain and name (section 6.7)", () => {
  const spans = functionsIn("a.ts", SOURCE);
  const at = (key: string): { start: number; end: number } | undefined => {
    const found = spans.find((span) => span.key === key);
    return found === undefined ? undefined : { start: found.start, end: found.end };
  };

  it("keys declarations, bound arrows, methods, accessors, properties and nested functions", () => {
    expect(at("a.ts::outer")).toEqual({ start: 1, end: 4 });
    expect(at("a.ts::outer.inner")).toEqual({ start: 2, end: 2 });
    expect(at("a.ts::f")).toEqual({ start: 5, end: 5 });
    expect(at("a.ts::C.constructor")).toEqual({ start: 7, end: 7 });
    expect(at("a.ts::C.m")).toEqual({ start: 8, end: 8 });
    expect(at("a.ts::C.g")).toEqual({ start: 9, end: 9 });
    expect(at("a.ts::C.s")).toEqual({ start: 10, end: 10 });
    expect(at("a.ts::p")).toEqual({ start: 12, end: 12 });
    expect(at("a.ts::q")).toEqual({ start: 12, end: 12 });
  });

  it("keys an anonymous function by its parent's key and its 1-based order among them", () => {
    expect(at("a.ts::outer#1")).toEqual({ start: 3, end: 3 });
    expect(at("a.ts::<module>#1")).toEqual({ start: 13, end: 13 });
    expect(at("a.ts::<module>#2")).toEqual({ start: 14, end: 14 });
  });

  it("has one <module> pseudo-function per file, spanning it", () => {
    expect(at("a.ts::<module>")).toEqual({ start: 1, end: 14 });
    expect(spans.filter((span) => span.key.endsWith("::<module>"))).toHaveLength(1);
  });

  it("lists the spans in source order", () => {
    const starts = spans.map((span) => span.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it.each([
    [2, "a.ts::outer.inner"],
    [3, "a.ts::outer#1"],
    [4, "a.ts::outer"],
    [6, "a.ts::<module>"],
  ])("finds the innermost function line %i belongs to: %s", (line, key) => {
    expect(innermostAt(spans, line)?.key).toBe(key);
  });

  it("finds nothing for a line past the file", () => {
    expect(innermostAt(spans, 99)).toBeUndefined();
  });

  it("reads TSX, and a file with nothing but a module", () => {
    const tsx = functionsIn("b.tsx", "export const A = () => <div onClick={() => 1} />;\n");
    expect(tsx.map((span) => span.key)).toEqual(["b.tsx::<module>", "b.tsx::A", "b.tsx::A#1"]);
    expect(functionsIn("c.ts", "export const x = 1;\n").map((span) => span.key)).toEqual([
      "c.ts::<module>",
    ]);
  });
});
