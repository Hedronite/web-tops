import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILES } from "./profiles.ts";
import { PROTOCOL } from "./protocol.ts";
import { at, fixture, get, keys } from "./test-support.ts";
import { checkConfigFile, loadConfig } from "./validate.ts";

const dir = fixture("examples");

describe("G3d: one example config per launch class", () => {
  it("has a file for each class with a launch profile, and no other", () => {
    expect(readdirSync(dir).sort()).toEqual(PROFILES.map((p) => `${p.class}.yaml`).sort());
  });

  it.each(PROFILES.map((p) => p.class))("%s validates and passes check", (name) => {
    expect(checkConfigFile(join(dir, `${name}.yaml`)).ok).toBe(true);
  });

  it.each(PROFILES)(
    "$class says its class, hard, the protocol, and the profile's numbers",
    (profile) => {
      const loaded = loadConfig(join(dir, `${profile.class}.yaml`));
      const value = get(loaded, "value");
      expect(get(value, "class")).toBe(profile.class);
      expect(get(value, "enforce")).toBe("hard");
      expect(get(value, "protocol")).toBe(PROTOCOL);
      expect(at(value, ["gates", "coverage", "lines_floor"])).toBe(profile.linesFloor);
      expect(at(value, ["gates", "crap", "cap"])).toBe(profile.crapCap);
      expect(at(value, ["gates", "mutation", "unexplained_survivors_max"])).toBe(
        profile.unexplainedSurvivorsMax,
      );
    },
  );

  it.each(PROFILES)(
    "$class turns off only layers the class does not map or a later milestone adds, each with a reason",
    (profile) => {
      const value = get(loadConfig(join(dir, `${profile.class}.yaml`)), "value");
      const layers = get(value, "layers");
      for (const key of keys(layers).filter((candidate) => candidate !== "custom")) {
        const layer = get(layers, key);
        if (get(layer, "enabled") === false) {
          expect(String(get(layer, "reason")), key).toMatch(/\S/);
        } else {
          expect(profile.layers, key).toContain(key);
        }
      }
    },
  );

  it.each(["astro-site", "web-app"])("%s shows the reserved rendered and themes shapes", (name) => {
    const layers = get(get(loadConfig(join(dir, `${name}.yaml`)), "value"), "layers");
    expect(keys(get(layers, "rendered"))).toEqual(
      expect.arrayContaining(["routes", "widths", "reduced_motion"]),
    );
    expect(keys(get(layers, "themes"))).toEqual(
      expect.arrayContaining(["switch", "schemes", "tokens"]),
    );
  });
});
