import { describe, expect, it } from "vitest";
import { daysLeft, isCalendarDate, isExpired, utcDate } from "./dates.ts";
import { judge } from "./match.ts";
import { CLAMP_KEY, SUM_KEY, entry } from "./test-support.ts";

describe("dates", () => {
  it.each([
    ["2026-12-31", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-02-30", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["soon", false],
    ["2026-1-5", false],
    ["", false],
  ])("isCalendarDate(%j) is %s", (text, expected) => {
    expect(isCalendarDate(text)).toBe(expected);
  });

  it("takes the UTC calendar date of a moment, not the machine's", () => {
    expect(utcDate(new Date("2026-11-17T23:59:59Z"))).toBe("2026-11-17");
    expect(utcDate(new Date("2026-11-18T00:00:00Z"))).toBe("2026-11-18");
  });

  it("is expired once today is after the date, and valid through the day itself", () => {
    expect(isExpired("2026-11-17", "2026-11-17")).toBe(false);
    expect(isExpired("2026-11-17", "2026-11-18")).toBe(true);
    expect(isExpired("2026-11-17", "2026-11-16")).toBe(false);
    expect(isExpired(undefined, "2099-01-01")).toBe(false);
  });

  it("counts whole days to an expiry, across a month and a leap day", () => {
    expect(daysLeft("2026-11-17", "2026-11-17")).toBe(0);
    expect(daysLeft("2026-12-01", "2026-11-17")).toBe(14);
    expect(daysLeft("2024-03-01", "2024-02-28")).toBe(2);
    expect(daysLeft("2026-11-10", "2026-11-17")).toBe(-7);
    expect(daysLeft(undefined, "2026-11-17")).toBeUndefined();
  });
});

describe("judge", () => {
  const TODAY = "2026-11-17";
  const live = entry(CLAMP_KEY, { expires: "2027-01-01" });
  const forever = entry(SUM_KEY);

  it("explains a survivor a live entry accepts, and leaves the rest unexplained", () => {
    const found = judge([live], [CLAMP_KEY, SUM_KEY], TODAY);
    expect(found.explained).toEqual([CLAMP_KEY]);
    expect(found.unexplained).toEqual([SUM_KEY]);
    expect(found.expired).toEqual([]);
    expect(found.stale).toEqual([]);
  });

  it("needs all six fields equal: any one different leaves the survivor unexplained", () => {
    const changes = [
      { file: "src/other.ts" },
      { function: "src/clamp.ts::other" },
      { mutator: "ConditionalExpression" },
      { original: "n < high" },
      { replacement: "n >= low" },
      { occurrence: 2 },
    ];
    for (const change of changes) {
      expect(
        judge([entry(CLAMP_KEY)], [{ ...CLAMP_KEY, ...change }], TODAY).unexplained,
      ).toHaveLength(1);
    }
  });

  it("tells two survivors apart by occurrence alone: the entry for #2 leaves #1 unexplained", () => {
    const first = CLAMP_KEY;
    const second = { ...CLAMP_KEY, occurrence: 2 };
    const found = judge([entry(second)], [first, second], TODAY);
    expect(found.explained).toEqual([second]);
    expect(found.unexplained).toEqual([first]);
  });

  it("stops an expired entry accepting, and fails the entry itself", () => {
    const old = entry(CLAMP_KEY, { expires: "2026-11-16" });
    const found = judge([old], [CLAMP_KEY], TODAY);
    expect(found.unexplained).toEqual([CLAMP_KEY]);
    expect(found.expired).toEqual([old]);
  });

  it("still accepts on the day the entry names", () => {
    const found = judge([entry(CLAMP_KEY, { expires: TODAY })], [CLAMP_KEY], TODAY);
    expect(found.explained).toEqual([CLAMP_KEY]);
    expect(found.expired).toEqual([]);
  });

  it("fails an expired entry even when its survivor is gone", () => {
    const old = entry(CLAMP_KEY, { expires: "2026-01-01" });
    const found = judge([old], [], TODAY);
    expect(found.expired).toEqual([old]);
    expect(found.stale).toEqual([]);
  });

  it("lists a live entry whose survivor is gone as stale, and does not fail it", () => {
    const found = judge([live, forever], [CLAMP_KEY], TODAY);
    expect(found.stale).toEqual([forever]);
    expect(found.expired).toEqual([]);
  });

  it("is empty for an empty ledger and no survivors", () => {
    expect(judge([], [], TODAY)).toEqual({
      explained: [],
      unexplained: [],
      expired: [],
      stale: [],
    });
  });

  it("counts an entry that does not expire as live on any day", () => {
    expect(judge([forever], [SUM_KEY], "2099-12-31").explained).toEqual([SUM_KEY]);
  });
});
