import { describe, expect, it } from "vitest";
import { guides, readingTime } from "./guides.ts";

describe("guides", () => {
  it("gives every guide its own id, which is its anchor on the page", () => {
    expect(guides().map((guide) => guide.id)).toEqual(["start", "gate"]);
  });

  it("says how long each takes", () => {
    expect(guides().map((guide) => readingTime(guide.minutes))).toEqual(["4 minutes", "7 minutes"]);
    expect(readingTime(1)).toBe("1 minute");
  });
});
