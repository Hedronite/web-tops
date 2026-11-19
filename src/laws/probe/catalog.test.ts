import { describe, expect, it } from "vitest";
import { interimLaws, lawsOfClass } from "./catalog.ts";

const ids = (className: string): string[] =>
  lawsOfClass(interimLaws(), className).map((law) => law.id);

describe("G3a the classes that map each law (WEB_TOPS.md section 5.2)", () => {
  it("a ts-library and a node-service map the laws every class maps, and neither W-22 nor W-26", () => {
    expect(ids("ts-library")).toEqual(ids("node-service"));
    expect(ids("ts-library")).toContain("W-01");
    expect(ids("ts-library")).not.toContain("W-22");
    expect(ids("ts-library")).not.toContain("W-26");
  });

  it("ui-components, astro-site and web-app map W-22 and W-26 beside them", () => {
    for (const className of ["ui-components", "astro-site", "web-app"]) {
      expect(ids(className)).toEqual(interimLaws().map((law) => law.id));
    }
  });

  it("a class the catalog does not know maps only the laws every class maps", () => {
    expect(ids("cli")).toEqual(ids("ts-library"));
    expect(lawsOfClass([], "ts-library")).toEqual([]);
  });
});
