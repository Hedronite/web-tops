import { describe, expect, it } from "vitest";
import { hashEntries, shardOf } from "./shard.ts";

const ENTRIES = [
  "src/b.ts:10-12",
  "src/a.ts:1-40",
  "src/a.ts:50-52",
  "src/c.ts:5-9",
  "src/c.ts",
  "src/d.ts:3-3",
  "src/e.ts:7-30",
];

const shards = (entries: readonly string[], count: number): string[][] =>
  Array.from({ length: count }, (_, at) => shardOf(entries, at + 1, count));

describe("shardOf splits the mutate entries into disjoint, complete, reproducible groups", () => {
  it("covers every entry exactly once, whatever the number of shards", () => {
    for (const count of [1, 2, 3, 4, 7, 12]) {
      const joined = shards(ENTRIES, count).flat();
      expect([...joined].sort()).toEqual([...ENTRIES].sort());
    }
  });

  it("is one shard holding everything, in source order including end line tie-breakers", () => {
    expect(shardOf([...ENTRIES, "src/a.ts:1-20"], 1, 1)).toEqual([
      "src/a.ts:1-20",
      "src/a.ts:1-40",
      "src/a.ts:50-52",
      "src/b.ts:10-12",
      "src/c.ts",
      "src/c.ts:5-9",
      "src/d.ts:3-3",
      "src/e.ts:7-30",
    ]);
  });

  it("does not depend on the order the entries are given in, or on repeats", () => {
    const reversed = [...ENTRIES].reverse();
    expect(shards(reversed, 3)).toEqual(shards(ENTRIES, 3));
    expect(shards([...ENTRIES, ...ENTRIES], 3)).toEqual(shards(ENTRIES, 3));
  });

  it("gives the heavy entries to different shards, and parses multi-digit and anchored ranges", () => {
    const [first, second] = shards(ENTRIES, 2);
    expect(first).toEqual(["src/a.ts:1-40"]);
    expect(second).toEqual([
      "src/a.ts:50-52",
      "src/b.ts:10-12",
      "src/c.ts",
      "src/c.ts:5-9",
      "src/d.ts:3-3",
      "src/e.ts:7-30",
    ]);
    // Multi-digit start (10-25 = 16 lines) vs 1-10 (10 lines) vs single line 1-1 (1 line) vs unanchored/trailing text
    expect(shards(["src/a.ts:10-25", "src/b.ts:1-10", "src/c.ts:1-1"], 2)).toEqual([
      ["src/a.ts:10-25"],
      ["src/b.ts:1-10", "src/c.ts:1-1"],
    ]);
    expect(shards(["src/a.ts:1-1", "src/b.ts:1-1", "src/c.ts:1-1"], 2)).toEqual([
      ["src/a.ts:1-1", "src/c.ts:1-1"],
      ["src/b.ts:1-1"],
    ]);
    expect(shards(["src/a.ts:1-10x", "src/b.ts:1-5"], 2)).toEqual([
      ["src/b.ts:1-5"],
      ["src/a.ts:1-10x"],
    ]);
    expect(shardOf(["src/a.ts:1-10x", "prefix\nsrc/a.ts:1-20", "src/a.ts:1-2"], 1, 1)).toEqual([
      "prefix\nsrc/a.ts:1-20",
      "src/a.ts:1-2",
      "src/a.ts:1-10x",
    ]);
  });

  it("takes the weight from the caller, such as the lines of a whole file", () => {
    const weigh = (entry: { text: string }): number => (entry.text === "src/c.ts" ? 100 : 1);
    const [alone] = [shardOf(ENTRIES, 1, 2, weigh), shardOf(ENTRIES, 2, 2, weigh)].filter((group) =>
      group.includes("src/c.ts"),
    );
    expect(alone).toEqual(["src/c.ts"]);
  });

  it("has an empty shard when there are fewer entries than shards", () => {
    expect(shards(["src/a.ts:1-2"], 3)).toEqual([["src/a.ts:1-2"], [], []]);
  });

  it("refuses a shard that is not one of the count with an informative message", () => {
    for (const [index, count] of [
      [0, 2],
      [3, 2],
      [1, 0],
      [1.5, 2],
      [1, Number.NaN],
    ] as const) {
      expect(() => shardOf(ENTRIES, index, count)).toThrow(RangeError);
      expect(() => shardOf(ENTRIES, index, count)).toThrow(
        `shard ${String(index)}/${String(count)} is not a shard`,
      );
    }
  });
});

describe("hashEntries produces a canonical SHA-256 digest", () => {
  it("is deterministic across input order and duplicates, separates lines with newline, and hashes empty", () => {
    const base = hashEntries(ENTRIES);
    expect(base).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashEntries([...ENTRIES].reverse())).toBe(base);
    expect(hashEntries([...ENTRIES, ...ENTRIES])).toBe(base);
    expect(hashEntries([])).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashEntries(["src/a.ts:1-2"])).not.toBe(hashEntries([]));
    expect(hashEntries(["src/a.ts:1-2", "src/b.ts:3-4"])).not.toBe(
      hashEntries(["src/a.ts:1-2src/b.ts:3-4"]),
    );
  });
});
