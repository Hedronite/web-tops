import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LAYER_KEYS, PROFILES } from "../config/profiles.ts";
import { PROFILES_DIR, loadProfile } from "./profile.ts";

/** profiles/*.yaml (drop-in data, this lane) must agree with src/config/profiles.ts (the one class table). */
describe("drop-in profiles agree with the class table", () => {
  it("has one profile file per launch class and no other", () => {
    const files = readdirSync(PROFILES_DIR)
      .filter((name) => name.endsWith(".yaml"))
      .map((name) => name.replace(/\.yaml$/, ""))
      .sort();
    expect(files).toEqual(PROFILES.map((profile) => profile.class).sort());
  });

  describe.each(PROFILES)("$class", (table) => {
    const loaded = loadProfile(table.class);
    if (!loaded.ok) throw new Error(loaded.error);
    const { profile } = loaded;

    it("carries the section 5.2 floor, cap and survivors limit", () => {
      expect(profile.coverage_floor).toBe(table.linesFloor);
      expect(profile.crap_cap).toBe(table.crapCap);
      expect(profile.survivors_max).toBe(table.unexplainedSurvivorsMax);
    });

    it("disables a layer as 'not mapped' exactly when the class table does not map it", () => {
      for (const key of LAYER_KEYS) {
        const reason = profile.disabled[key];
        const unmapped = !table.layers.includes(key);
        expect(reason?.startsWith("not mapped for class:") ?? false, key).toBe(unmapped);
        if (!unmapped && reason !== undefined) expect(reason, key).toMatch(/^milestone M[234]: /);
      }
    });

    it("disables stylelint exactly when the class table does not map that step", () => {
      const unmapped = !table.steps.includes("stylelint");
      expect(profile.disabled["stylelint"]?.startsWith("not mapped for class:") ?? false).toBe(
        unmapped,
      );
    });

    it("maps astro check as WEB_TOPS.md section 9 says: always, with the project, or never", () => {
      const expected: Record<string, string> = {
        "astro-site": "always",
        "ui-components": "project",
        "web-app": "project",
      };
      expect(profile.astro_check).toBe(expected[table.class] ?? "never");
      expect(profile.tools).not.toContain("astro");
      expect(profile.tools).not.toContain("@astrojs/check");
      if (profile.astro_check === "never") {
        expect(profile.disabled["astro_check"]).toMatch(/^not mapped for class: \S/);
      } else {
        expect(profile.disabled["astro_check"]).toBeUndefined();
      }
    });

    it("leaves crap, mutation and laws off with a milestone, and no tier-1 gate off", () => {
      for (const key of ["crap", "mutation", "laws"])
        expect(profile.disabled[key], key).toMatch(/^milestone M/);
      for (const key of ["eslint", "audit", "format", "tests", "coverage"]) {
        expect(profile.disabled[key], key).toBeUndefined();
      }
    });
  });
});
