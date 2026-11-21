import { describe, expect, it } from "vitest";
import { catalogSeverity, severityOf } from "./severity.ts";

describe("severityOf: the severity of each law of a list", () => {
  const laws = [
    { id: "W-01", severity: "R" },
    { id: "W-28", severity: "A" },
  ] as const;

  it("is each law's severity, and none for an id that is not in the list", () => {
    const severity = severityOf(laws);
    expect([severity("W-01"), severity("W-28"), severity("W-99")]).toEqual(["R", "A", undefined]);
  });

  it("knows no law of an empty list", () => {
    expect(severityOf([])("W-01")).toBeUndefined();
  });
});

describe("catalogSeverity: the severity of the laws a catalog loads", () => {
  it("reads the catalog it is given, once, when it is called", () => {
    let loads = 0;
    const severity = catalogSeverity(() => {
      loads += 1;
      return [{ id: "W-28", severity: "A" }];
    });
    expect([severity("W-28"), severity("W-28"), severity("W-04")]).toEqual(["A", "A", undefined]);
    expect(loads).toBe(1);
  });
});
