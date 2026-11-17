import { describe, expect, it } from "vitest";
import { CLASSES, LAYER_KEYS, PROFILES, STEP_KEYS, profileFor } from "./profiles.ts";

describe("R7: the class table", () => {
  it("has a launch profile for the five launch classes only", () => {
    expect(PROFILES.map((profile) => profile.class)).toEqual([
      "ts-library",
      "ui-components",
      "astro-site",
      "web-app",
      "node-service",
    ]);
    for (const name of ["cli", "workspace-root", "config-only", "spa", ""]) {
      expect(profileFor(name), name).toBeUndefined();
    }
    for (const profile of PROFILES) expect(CLASSES).toContain(profile.class);
  });

  it.each([
    ["ts-library", 85, 4, 0],
    ["ui-components", 80, 5, 1],
    ["astro-site", 70, 6, 2],
    ["web-app", 70, 6, 2],
    ["node-service", 80, 5, 1],
  ])("%s carries the section 5.2 floor %i, CRAP cap %i and survivors %i", (name, floor, cap, survivors) => {
    expect(profileFor(name)).toMatchObject({
      linesFloor: floor,
      crapCap: cap,
      unexplainedSurvivorsMax: survivors,
    });
  });

  it("maps the layers section 5.2 gives each class", () => {
    expect(profileFor("ts-library")?.layers).toEqual(["package_exports", "size_limit"]);
    expect(profileFor("ui-components")?.layers).toEqual([
      "package_exports",
      "size_limit",
      "html_validate",
      "axe",
    ]);
    for (const name of ["astro-site", "web-app"]) {
      expect(profileFor(name)?.layers, name).toEqual(["html_validate", "axe", "rendered", "themes"]);
    }
    expect(profileFor("node-service")?.layers).toEqual([]);
  });

  it("maps astro_check to the Astro classes and stylelint to the classes with CSS", () => {
    const mapped = (step: string): string[] =>
      PROFILES.filter((profile) => profile.steps.some((candidate) => candidate === step)).map(
        (profile) => profile.class,
      );
    expect(mapped("astro_check")).toEqual(["astro-site", "web-app"]);
    expect(mapped("stylelint")).toEqual(["ui-components", "astro-site", "web-app"]);
    for (const step of ["install", "tsc", "eslint", "format", "dependency_cruiser", "audit"]) {
      expect(mapped(step), step).toHaveLength(PROFILES.length);
    }
  });

  it("only maps known layers and steps", () => {
    for (const profile of PROFILES) {
      for (const layer of profile.layers) expect(LAYER_KEYS).toContain(layer);
      for (const step of profile.steps) expect(STEP_KEYS).toContain(step);
    }
  });
});
