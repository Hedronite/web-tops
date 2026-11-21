import { describe, expect, it } from "vitest";
import { changeOf, compareRanked, comparePart, sign } from "./rank.ts";
import type { Part, Ranked } from "./types.ts";

const two: Ranked = { shown: "2", rank: 2 };
const one: Ranked = { shown: "1", rank: 1 };

describe("which of two numbers is higher", () => {
  it("is 1 when the second is, -1 when the first is, and 0 when they are the same", () => {
    expect([sign(1, 2), sign(2, 1), sign(2, 2), sign(0, 0), sign(-1, 0)]).toEqual([1, -1, 0, 0, 1]);
  });
});

describe("how a value moved", () => {
  it("is weaker when it is lower or gone, stronger when it is higher or new, and unchanged when it is the same", () => {
    expect(changeOf(two, one)).toBe("weakened");
    expect(changeOf(one, two)).toBe("strengthened");
    expect(changeOf(two, two)).toBe("unchanged");
    expect(changeOf(two, undefined)).toBe("weakened");
    expect(changeOf(undefined, one)).toBe("strengthened");
    expect(changeOf(undefined, undefined)).toBe("unchanged");
  });
});

describe("the values that moved between two maps", () => {
  it("lists each by name in order, with what it was and what it is, and leaves out what did not move", () => {
    const base = new Map([
      ["b", two],
      ["a", one],
      ["c", one],
      ["gone", two],
    ]);
    const head = new Map([
      ["a", two],
      ["b", one],
      ["c", one],
      ["new", one],
    ]);
    expect(compareRanked(base, head)).toEqual([
      { what: "a", change: "strengthened", before: "1", after: "2" },
      { what: "b", change: "weakened", before: "2", after: "1" },
      { what: "gone", change: "weakened", before: "2", after: "absent" },
      { what: "new", change: "strengthened", before: "absent", after: "1" },
    ]);
  });
});

const ok = (value: number): Part<number> => ({ state: "ok", value });
const absent: Part<number> = { state: "absent" };
const broken = (message: string): Part<number> => ({ state: "error", message });
const compare = (base: number, head: number): { items: []; compared: number; note: string } => ({
  items: [],
  compared: base + head,
  note: "both",
});

describe("a surface across two refs", () => {
  it("is compared when both refs have it, with what was compared and any note", () => {
    expect(comparePart("s", ok(1), ok(2), compare)).toEqual({
      name: "s",
      compared: 3,
      items: [],
      note: "both",
    });
  });

  it("is weaker when the head has lost it and stronger when the head has gained it", () => {
    expect(comparePart("s", ok(1), absent, compare)).toMatchObject({
      compared: 1,
      items: [{ what: "s", change: "weakened", before: "present", after: "absent" }],
    });
    expect(comparePart("s", absent, ok(1), compare).items).toEqual([
      { what: "s", change: "strengthened", before: "absent", after: "present" },
    ]);
  });

  it("is unchanged, and says it is not there, when neither ref has it", () => {
    expect(comparePart("s", absent, absent, compare)).toEqual({
      name: "s",
      compared: 0,
      items: [],
      note: "not there at either ref",
    });
  });

  it("is weaker, never a pass, when it cannot be read at a ref, and says which and why", () => {
    expect(comparePart("s", broken("bad yaml"), ok(1), compare)).toEqual({
      name: "s",
      compared: 0,
      items: [
        {
          what: "the surface at base",
          change: "weakened",
          before: "readable",
          after: "cannot be read: bad yaml",
        },
      ],
    });
    expect(comparePart("s", ok(1), broken("no eslint"), compare).items[0]).toMatchObject({
      what: "the surface at head",
      after: "cannot be read: no eslint",
    });
    expect(comparePart("s", broken("one"), broken("two"), compare).items).toHaveLength(1);
  });
});
