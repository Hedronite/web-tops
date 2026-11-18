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
    expect(snap(["src/a.ts:3-5"])).toEqual(["src/a.ts:1-7"]);
    expect(snap(["src/a.ts:2-2", "src/a.ts:3-3"])).toEqual(["src/a.ts:1-3"]);
    expect(snap(["src/a.ts:2-2", "src/a.ts:6-6"])).toEqual(["src/a.ts:1-3", "src/a.ts:5-7"]);
  });

  it("keeps module-level lines as they are: the module is no unit to mutate whole", () => {
    expect(snap(["src/a.ts:18-18"])).toEqual(["src/a.ts:18-18"]);
  });

  it("keeps the lines of a range that only partly lies in a function", () => {
    expect(snap(["src/a.ts:3-4"])).toEqual(["src/a.ts:1-4"]);
    expect(snap(["src/a.ts:17-18"])).toEqual(["src/a.ts:17-18"]);
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
