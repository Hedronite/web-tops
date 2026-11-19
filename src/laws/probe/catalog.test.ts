import { describe, expect, it } from "vitest";
import { catalogLaws, lawsOfClass } from "./catalog.ts";

const ids = (className: string): string[] =>
  lawsOfClass(catalogLaws(), className).map((law) => law.id);

describe("G3a the laws the probe proves are the catalog's ticked lint and compiler laws", () => {
  it("reads the fourteen laws a lint rule or a flag judges, in order, from laws/W-NN.yaml", () => {
    expect(catalogLaws().map((law) => law.id)).toEqual([
      "W-01",
      "W-02",
      "W-04",
      "W-05",
      "W-06",
      "W-10",
      "W-11",
      "W-13",
      "W-14",
      "W-15",
      "W-22",
      "W-26",
      "W-34",
      "W-35",
    ]);
  });

  it("a ts-library and a node-service map the laws every class maps, and neither W-22 nor W-26", () => {
    expect(ids("ts-library")).toEqual(ids("node-service"));
    expect(ids("ts-library")).toContain("W-01");
    expect(ids("ts-library")).not.toContain("W-22");
    expect(ids("ts-library")).not.toContain("W-26");
  });

  it("W-22 is mapped by the classes with JSX and W-26 by those with raw CSS, as the catalog says", () => {
    for (const className of ["ui-components", "astro-site", "web-app"]) {
      expect(ids(className)).toContain("W-22");
    }
    expect(ids("ui-components")).not.toContain("W-26");
    expect(ids("astro-site")).toContain("W-26");
    expect(ids("web-app")).toContain("W-26");
  });

  it("a class the catalog does not know maps nothing, and a law with no class list is mapped by every class", () => {
    expect(ids("cli")).toEqual([]);
    expect(lawsOfClass([], "ts-library")).toEqual([]);
    expect(lawsOfClass([{ id: "W-99", proofs: [] }], "anything")).toHaveLength(1);
  });
});
