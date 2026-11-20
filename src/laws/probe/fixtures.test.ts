import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkers } from "./markers.ts";
import { provenBy } from "./proofs.ts";
import { kitProbeLaws } from "./testkit.ts";
import { listTwins } from "./twins.ts";

const FIXTURES = resolve(import.meta.dirname, "../../../fixtures/laws");
const LAWS = kitProbeLaws();
const TWINS = listTwins(FIXTURES, LAWS);

const text = (file: string): string => readFileSync(join(FIXTURES, file), "utf8");

describe("G3a every law the probe proves has a bad and a clean twin, marked", () => {
  it("the catalog lists each law once, in order, with at least one proof", () => {
    const ids = LAWS.map((law) => law.id);
    expect(ids).toEqual([...new Set(ids)].sort());
    expect(LAWS.filter((law) => law.proofs.length === 0)).toEqual([]);
  });

  it.each(LAWS.map((law) => law.id))("%s has a bad twin and a clean twin", (id) => {
    const kinds = new Set(TWINS.filter((twin) => twin.law === id).map((twin) => twin.kind));
    expect([...kinds].sort()).toEqual(["bad", "clean"]);
  });

  it("no law directory under fixtures/laws is left out of the catalog", () => {
    const directories = readdirSync(FIXTURES).filter((name) =>
      statSync(join(FIXTURES, name)).isDirectory(),
    );
    expect(directories.sort()).toEqual(LAWS.map((law) => law.id));
  });

  it("only a bad twin carries a marker, and each file is an ES module so the twins do not share globals", () => {
    const withMarkers = TWINS.filter((twin) => parseMarkers(twin.file, text(twin.file)).length > 0);
    expect(withMarkers.every((twin) => twin.kind === "bad")).toBe(true);
    const sources = TWINS.filter(
      (twin) => !twin.file.endsWith(".css") && !twin.file.endsWith(".astro"),
    );
    const scripts = sources.filter((twin) => !/^(import|export) /mu.test(text(twin.file)));
    expect(scripts.map((twin) => twin.file)).toEqual([]);
  });

  it("each marker names a rule or a flag some law maps, or one of two rules a twin may name beside it", () => {
    const beside = ["no-fallthrough", "no-namespace"];
    const proofs = LAWS.flatMap((law) => law.proofs);
    const known = (name: string): boolean =>
      beside.includes(name) || proofs.some((proof) => provenBy(proof, name));
    const names = TWINS.flatMap((twin) => parseMarkers(twin.file, text(twin.file))).flatMap(
      (mark) => mark.rules,
    );
    expect(names.filter((name) => !known(name))).toEqual([]);
  });

  it("has a README that says how a twin is written", () => {
    const readme = readFileSync(join(FIXTURES, "README.md"), "utf8");
    expect(readme).toContain("// expect:");
    expect(readme).toContain("webtops laws probe");
  });
});
