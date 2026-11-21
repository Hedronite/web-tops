import { describe, expect, it } from "vitest";
import { invalidReport, joinReports } from "./check.ts";

/** What `webtops check` writes for a configuration that is not valid: the file name, then a line for each problem. */
describe("invalidReport", () => {
  it("names the file, then each problem on its own line, with the document as (document)", () => {
    const text = invalidReport("web-tops.yaml", [
      { pointer: "/bogus", message: "unknown key" },
      { pointer: "", message: "empty" },
      { pointer: "/class", message: "missing" },
    ]);
    expect(text).toBe(
      "web-tops.yaml: invalid\n  /bogus: unknown key\n  (document): empty\n  /class: missing\n",
    );
  });
});

/** `webtops check` reports every ledger that is not sound, not only the first. */
describe("joinReports", () => {
  it("is nothing when no report says anything", () => {
    expect(joinReports(undefined, undefined)).toBeUndefined();
    expect(joinReports()).toBeUndefined();
  });

  it("is the one report that says something", () => {
    expect(joinReports("a: invalid\n", undefined)).toBe("a: invalid\n");
    expect(joinReports(undefined, "b: invalid\n")).toBe("b: invalid\n");
  });

  it("is each report, in the order given, one after the other", () => {
    expect(joinReports("a: invalid\n  x\n", undefined, "b: invalid\n  y\n")).toBe(
      "a: invalid\n  x\nb: invalid\n  y\n",
    );
  });
});
