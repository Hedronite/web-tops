import { describe, expect, it } from "vitest";
import type { Catalog, Law } from "../catalog/index.ts";
import { entryOf, yamlCatalog } from "./catalog.ts";

const law = (id: string, extra: Partial<Law> = {}): Law => ({
  id,
  title: "t",
  family: "Types",
  severity: "R",
  classes: ["ts-library", "node-service"],
  reader: { kinds: ["tl"], text: "tl: x" },
  rules: [{ tool: "eslint", name: "no-explicit-any" }],
  judged: "v0.1",
  rationale: "r",
  fix: "f",
  ...extra,
});

describe("G4a the laws layer takes its laws from the catalog's files", () => {
  it("a law is its id, severity, first reader kind, classes and rules", () => {
    expect(entryOf(law("W-01"))).toEqual({
      id: "W-01",
      severity: "R",
      reader: "tl",
      classes: ["ts-library", "node-service"],
      judged: true,
      rules: [{ tool: "eslint", name: "no-explicit-any" }],
    });
    expect(
      entryOf(law("W-03", { severity: "A", reader: { kinds: ["at", "an"], text: "" } })),
    ).toMatchObject({
      severity: "A",
      reader: "at",
    });
  });

  it("a law with no reader kind is not built yet", () => {
    expect(entryOf(law("W-03", { reader: { kinds: [], text: "" } })).reader).toBe("tbd");
  });

  it("a law is judged when the catalog says v0.1 or that M3 gives it a reader, and not when it says no", () => {
    expect(
      ["v0.1", "m3", "no"].map(
        (judged) =>
          entryOf(law("W-09", { judged: judged === "no" ? "no" : judged === "m3" ? "m3" : "v0.1" }))
            .judged,
      ),
    ).toEqual([true, true, false]);
  });
});

describe("G4a the catalog of the kit", () => {
  it("maps every law the loader gives, in order, from the directory it is told", () => {
    const seen: string[] = [];
    const load = (dir: string): Catalog => {
      seen.push(dir);
      return { ok: true, laws: [law("W-01"), law("W-02")] };
    };
    expect(yamlCatalog(load, "somewhere").map((entry) => entry.id)).toEqual(["W-01", "W-02"]);
    expect(seen).toEqual(["somewhere"]);
    yamlCatalog(load);
    expect(seen[1]?.endsWith("/laws")).toBe(true);
  });

  it("a catalog with a file that is not valid fails with each problem, not an empty list", () => {
    const bad: Catalog = {
      ok: false,
      problems: [
        { file: "W-01.yaml", pointer: "/id", message: "is required" },
        { file: "W-02.yaml", pointer: "", message: "is not a map" },
      ],
    };
    expect(() => yamlCatalog(() => bad)).toThrow(
      "the law catalog is invalid: W-01.yaml/id: is required; W-02.yaml: is not a map",
    );
  });
});
