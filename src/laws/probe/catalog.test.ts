import { describe, expect, it } from "vitest";
import type { Catalog } from "../catalog/index.ts";
import { CatalogError, lawsOfClass, readCatalog } from "./catalog.ts";
import { kitProbeLaws } from "./testkit.ts";

const ids = (className: string): string[] =>
  lawsOfClass(kitProbeLaws(), className).map((law) => law.id);

describe("G3a the laws the probe proves are the catalog's ticked lint and compiler laws", () => {
  it("reads the fifteen laws a lint rule or a flag judges (judged v0.1 or m3), in order, from laws/W-NN.yaml", () => {
    expect(kitProbeLaws().map((law) => law.id)).toEqual([
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
      "W-49",
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

  it("W-49 is mapped by the astro-site class alone", () => {
    expect(ids("astro-site")).toContain("W-49");
    for (const className of ["ts-library", "ui-components", "web-app", "node-service"]) {
      expect(ids(className)).not.toContain("W-49");
    }
  });

  it("a class the catalog does not know maps nothing, and a law with no class list is mapped by every class", () => {
    expect(ids("cli")).toEqual([]);
    expect(lawsOfClass([], "ts-library")).toEqual([]);
    expect(lawsOfClass([{ id: "W-99", proofs: [] }], "anything")).toHaveLength(1);
  });
});

const bad: Catalog = {
  ok: false,
  problems: [
    { file: "W-01.yaml", pointer: "/id", message: "is required" },
    { file: "W-02.yaml", pointer: "", message: "is not a map" },
  ],
};

describe("G3a a catalog that cannot be read is an error with its problems", () => {
  it("names each problem file and pointer, joined by semicolons, and is a CatalogError", () => {
    let caught: unknown;
    try {
      readCatalog("laws", () => bad);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CatalogError);
    expect(caught instanceof Error && caught.message).toBe(
      "the catalog is invalid: W-01.yaml/id: is required; W-02.yaml: is not a map",
    );
  });

  it("reads the directory it is given, and the kit's laws directory when it is given none", () => {
    const seen: string[] = [];
    const ok = (dir: string): Catalog => {
      seen.push(dir);
      return { ok: true, laws: [] };
    };
    expect(readCatalog("somewhere", ok)).toEqual([]);
    readCatalog(undefined, ok);
    expect(seen[0]).toBe("somewhere");
    expect(seen[1]?.endsWith("/laws")).toBe(true);
  });
});
