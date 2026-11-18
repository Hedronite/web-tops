import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadTypeScript } from "../../complexity/index.ts";
import { snapEntries } from "./snap.ts";

/** G7a (R64): each range to mutate is widened to the scored unit that holds it, so whole functions are mutated. */

const ts = loadTypeScript(resolve(import.meta.dirname, "../../.."));

const TEXT = [
  "export function a(x: number): number {", // 1
  "  return x ? 1 : 2;", // 2
  "}", // 3
  "", // 4
  "export function b(y: number[]): number[] {", // 5
  "  return y.map((z) => (z ? 3 : 4));", // 6
  "}", // 7
  "", // 8
  "export class Box {", // 9
  "  open(n: number): number {", // 10
  "    return n ? 1 : 0;", // 11
  "  }", // 12
  "  close(): number {", // 13
  "    return 1;", // 14
  "  }", // 15
  "}", // 16
  "", // 17
  "export const top = process.argv.length > 2 ? 1 : 2;", // 18
  "",
].join("\n");

function snap(entries: readonly string[], text: string | null = TEXT): string[] {
  return snapEntries(ts, entries, () => text ?? undefined);
}

describe("G7a snapEntries widens a range to its scored unit", () => {
  it("takes a one-line change to the whole function", () => {
    expect(snap(["src/a.ts:2-2"])).toEqual(["src/a.ts:1-3"]);
  });

  it("takes a change inside a callback to the function that holds it", () => {
    expect(snap(["src/a.ts:6-6"])).toEqual(["src/a.ts:5-7"]);
  });

  it("takes a change in a class member to that member, not the class", () => {
    expect(snap(["src/a.ts:11-11"])).toEqual(["src/a.ts:10-12"]);
  });

  it("joins the units a range crosses, and merges units that touch or overlap", () => {
    expect(snap(["src/a.ts:3-5"])).toEqual(["src/a.ts:1-9", "src/a.ts:16-19"]);
    expect(snap(["src/a.ts:2-2", "src/a.ts:3-3"])).toEqual(["src/a.ts:1-3"]);
    expect(snap(["src/a.ts:2-2", "src/a.ts:6-6"])).toEqual(["src/a.ts:1-3", "src/a.ts:5-7"]);
  });

  it("widens a module-level range to every module-level line of the file, so <module> occurrences do not depend on the diff", () => {
    const module = ["src/a.ts:4-4", "src/a.ts:8-9", "src/a.ts:16-19"];
    expect(snap(["src/a.ts:18-18"])).toEqual(module);
    expect(snap(["src/a.ts:4-4"])).toEqual(module);
    expect(snap(["src/a.ts:9-9"])).toEqual(module);
  });

  it("gives the same entries for any module line the diff touched, and none of the functions' lines", () => {
    expect(snap(["src/a.ts:18-18"])).toEqual(snap(["src/a.ts:16-16"]));
    expect(snap(["src/a.ts:18-18"]).some((entry) => /:(?:1-3|5-7|10-15)$/u.test(entry))).toBe(
      false,
    );
  });

  it("adds the module lines to the units a range reaches, when it touches both", () => {
    expect(snap(["src/a.ts:3-4"])).toEqual(["src/a.ts:1-4", "src/a.ts:8-9", "src/a.ts:16-19"]);
    expect(snap(["src/a.ts:17-18"])).toEqual(["src/a.ts:4-4", "src/a.ts:8-9", "src/a.ts:16-19"]);
  });

  it("counts a module line that is the last line of the file, with no newline after it", () => {
    const last = "const y = 1;\nexport function a(): number {\n  return 1;\n}\nexport const x = 1;";
    expect(snap(["src/a.ts:1-1"], last)).toEqual(["src/a.ts:1-1", "src/a.ts:5-5"]);
    expect(snap(["src/a.ts:3-3"], last)).toEqual(["src/a.ts:2-4"]);
  });

  it("leaves a file with no module line to its units", () => {
    const only = "export function a(): number {\n  return 1;\n}";
    expect(snap(["src/a.ts:2-2"], only)).toEqual(["src/a.ts:1-3"]);
  });

  it("works per file, in file order, and merges only within a file", () => {
    expect(snap(["src/b.ts:2-2", "src/a.ts:2-2", "src/a.ts:6-6"])).toEqual([
      "src/a.ts:1-3",
      "src/a.ts:5-7",
      "src/b.ts:1-3",
    ]);
  });

  it("leaves an entry as it is when its file cannot be read or parsed, or has no range", () => {
    expect(snap(["src/a.ts:2-2"], null)).toEqual(["src/a.ts:2-2"]);
    expect(snap(["src/a.ts:2-2"], "export function (\n")).toEqual(["src/a.ts:2-2"]);
    expect(snap(["src/a.ts"])).toEqual(["src/a.ts"]);
    expect(snap(["not an entry"])).toEqual(["not an entry"]);
  });

  it("gives nothing for no entries", () => {
    expect(snap([])).toEqual([]);
  });
});
