import { describe, expect, it } from "vitest";
import { changeOf } from "./rank.ts";
import type { Ranked } from "./types.ts";

const at = (rank: number, shown = String(rank), review?: boolean): Ranked =>
  review === undefined ? { shown, rank } : { shown, rank, review };

describe("a value that is new", () => {
  it("is stronger only when it holds something: a rank above 0", () => {
    expect(changeOf(undefined, at(1))).toBe("strengthened");
    expect(changeOf(undefined, at(3))).toBe("strengthened");
    expect(changeOf(undefined, at(0))).toBe("unchanged");
    expect(changeOf(undefined, at(-2))).toBe("unchanged");
    expect(changeOf(undefined, undefined)).toBe("unchanged");
  });
});

describe("a value that is gone", () => {
  it("is weaker only when it held something: a rank above 0", () => {
    expect(changeOf(at(1), undefined)).toBe("weakened");
    expect(changeOf(at(3), undefined)).toBe("weakened");
    expect(changeOf(at(0), undefined)).toBe("unchanged");
    expect(changeOf(at(-2), undefined)).toBe("unchanged");
  });
});

describe("a value that is for review", () => {
  it("is changed when its rank held and what it shows differs", () => {
    expect(changeOf(at(0, "a", true), at(0, "b", true))).toBe("changed");
  });

  it("is unchanged when what it shows is the same, or when it is not for review", () => {
    expect(changeOf(at(0, "a", true), at(0, "a", true))).toBe("unchanged");
    expect(changeOf(at(0, "a"), at(0, "b"))).toBe("unchanged");
    expect(changeOf(at(0, "a", false), at(0, "b", false))).toBe("unchanged");
  });

  it("is as its rank says when the rank moved, whether or not what it shows differs", () => {
    expect(changeOf(at(1, "a", true), at(2, "b", true))).toBe("strengthened");
    expect(changeOf(at(2, "a", true), at(1, "b", true))).toBe("weakened");
    expect(changeOf(at(1, "a", true), at(2, "a", true))).toBe("strengthened");
  });

  it("is only for review when the new value is, not the old one", () => {
    expect(changeOf(at(0, "a", true), at(0, "b"))).toBe("unchanged");
    expect(changeOf(at(0, "a"), at(0, "b", true))).toBe("changed");
  });
});
