import { describe, expect, it } from "vitest";
import { compareSets } from "./sets.ts";

describe("the entries of a set that moved", () => {
  it("is weaker when an entry is added to a set that loosens by gaining, and stronger when one is dropped", () => {
    expect(compareSets("exclude", ["old"], ["new", "old"], "added")).toEqual([
      { what: "exclude", change: "weakened", before: "not listed", after: "listed", where: "new" },
    ]);
    expect(compareSets("exclude", ["old", "kept"], ["kept"], "added")).toEqual([
      {
        what: "exclude",
        change: "strengthened",
        before: "listed",
        after: "not listed",
        where: "old",
      },
    ]);
  });

  it("is weaker when an entry is dropped from a set that loosens by losing, and stronger when one is added", () => {
    expect(compareSets("include", ["src", "lib"], ["src"], "removed")).toEqual([
      { what: "include", change: "weakened", before: "listed", after: "not listed", where: "lib" },
    ]);
    expect(compareSets("include", ["src"], ["src", "lib"], "removed")).toEqual([
      {
        what: "include",
        change: "strengthened",
        before: "not listed",
        after: "listed",
        where: "lib",
      },
    ]);
  });

  it("lists added entries before removed ones, each in name order, and nothing when the sets are the same", () => {
    const items = compareSets("s", ["b", "a"], ["d", "c"], "added");
    expect(items.map((item) => [item.change, item.where])).toEqual([
      ["weakened", "c"],
      ["weakened", "d"],
      ["strengthened", "a"],
      ["strengthened", "b"],
    ]);
    expect(compareSets("s", ["a", "b"], ["b", "a"], "added")).toEqual([]);
  });
});
