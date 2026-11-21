import { describe, expect, it } from "vitest";
import { compareSnapshots, weakenedCount } from "./compare.ts";
import { compareProfiles, profileNote } from "./profile.ts";
import type { Part, Profile, Ranked, Snapshot } from "./types.ts";

const absent: Part<never> = { state: "absent" };
const none = new Map<string, string>();
const strong: Ranked = { shown: "true", rank: 1 };
const weak: Ranked = { shown: "false", rank: 0 };

const rulesAt = (level: number): Snapshot["levels"] => ({
  state: "ok",
  value: new Map([["a.ts", new Map([["r", { level, options: "[]" }]])]]),
});

const settingsOf = (key: string, value: Ranked, globs: string[] = []): Snapshot["settings"] => ({
  state: "ok",
  value: { values: new Map([[key, value]]), globs },
});

const snapshot = (extra: Partial<Snapshot> = {}): Snapshot => ({
  tracked: ["a.ts"],
  tools: { state: "ok", value: new Map([["lock: eslint", "10.0.0"]]) },
  levels: rulesAt(2),
  flags: { state: "ok", value: new Map([["tsconfig.json: strict", strong]]) },
  settings: settingsOf("enforce", strong),
  laws: { state: "ok", value: new Map() },
  profile: { state: "ok", value: profile("ts-library", ["W-01"], ["tsc"]) },
  ...extra,
});

const profile = (className: string, required: string[], layers: string[]): Profile => ({
  className,
  required: new Set(required),
  layers: new Set(layers),
});

describe("the profile", () => {
  it("is weaker when a law the class required, or a layer it mapped, is gone, and stronger when one is added", () => {
    const base = profile("web-app", ["W-01", "W-02"], ["tsc"]);
    const head = profile("ts-library", ["W-01", "W-03"], ["tsc", "format"]);
    expect(compareProfiles(base, head)).toEqual([
      { what: "law W-02", change: "weakened", before: "required", after: "absent" },
      { what: "law W-03", change: "strengthened", before: "absent", after: "required" },
      { what: "layer format", change: "strengthened", before: "absent", after: "required" },
    ]);
  });

  it("says when the class changed, and nothing when it did not", () => {
    expect(profileNote(profile("web-app", [], []), profile("ts-library", [], []))).toBe(
      "class web-app became ts-library",
    );
    expect(profileNote(profile("web-app", [], []), profile("web-app", [], []))).toBeUndefined();
  });
});

describe("every surface of the diff", () => {
  it("is listed in a fixed order whether or not anything moved, with how many parts were compared", () => {
    const surfaces = compareSnapshots(snapshot(), snapshot(), none);
    expect(
      surfaces.map((surface) => [surface.name, surface.compared, surface.items.length]),
    ).toEqual([
      ["ESLint rule levels and options", 1, 0],
      ["compiler flags", 1, 0],
      ["gate settings, floors, caps and budgets", 1, 0],
      ["law catalog", 0, 0],
      ["profile", 2, 0],
      ["tool versions", 1, 1],
    ]);
    expect(weakenedCount(surfaces)).toBe(0);
  });

  it("finds a rule turned off, a flag dropped, a floor lowered and a class changed, each on its own surface", () => {
    const head = snapshot({
      levels: rulesAt(0),
      flags: { state: "ok", value: new Map([["tsconfig.json: strict", weak]]) },
      settings: settingsOf("enforce", weak),
      profile: { state: "ok", value: profile("web-app", ["W-01"], ["tsc"]) },
    });
    const surfaces = compareSnapshots(snapshot(), head, none);
    expect(surfaces.map((surface) => surface.items.map((item) => item.change))).toEqual([
      ["weakened"],
      ["weakened"],
      ["weakened"],
      [],
      [],
      ["unchanged"],
    ]);
    expect(surfaces[2]?.note).toContain("size budgets: only whether size_limit is on, until M4");
    expect(surfaces[4]?.note).toBe("class ts-library became web-app");
    expect(weakenedCount(surfaces)).toBe(3);
  });

  it("weakens on a coverage exclusion the head adds, and not on one it drops", () => {
    const base = snapshot({ settings: settingsOf("enforce", strong, ["old/**"]) });
    const head = snapshot({ settings: settingsOf("enforce", strong, ["src/**"]) });
    const surface = compareSnapshots(base, head, none)[2];
    expect(surface?.compared).toBe(3);
    expect(surface?.items.map((item) => [item.change, item.where])).toEqual([
      ["weakened", "src/**"],
      ["strengthened", "old/**"],
    ]);
  });

  it("says how many files and rules were compared, and weakens on a tracked file ESLint no longer reaches", () => {
    const dropped = snapshot({ levels: { state: "ok", value: new Map() } });
    const surface = compareSnapshots(snapshot(), dropped, none)[0];
    expect(surface?.note).toBe("1 files, 1 rules compared");
    expect(surface?.compared).toBe(1);
    expect(surface?.items.map((item) => [item.change, item.after])).toEqual([
      ["weakened", "no longer linted"],
    ]);
  });

  it("weakens on a tool that was dropped, never on one only changed", () => {
    const dropped = snapshot({ tools: { state: "ok", value: new Map() } });
    expect(weakenedCount(compareSnapshots(snapshot(), dropped, none))).toBe(1);
    const bumped = snapshot({
      tools: { state: "ok", value: new Map([["lock: eslint", "10.1.0"]]) },
    });
    const surfaces = compareSnapshots(snapshot(), bumped, none);
    expect(weakenedCount(surfaces)).toBe(0);
    expect(surfaces[5]?.items.map((item) => item.change)).toEqual(["changed"]);
  });

  it("counts every weakened item of every surface, and none that were only strengthened", () => {
    const only = snapshot({ settings: settingsOf("enforce", weak) });
    expect(weakenedCount(compareSnapshots(only, snapshot(), none))).toBe(0);
    expect(
      weakenedCount(compareSnapshots(snapshot({ flags: absent, laws: absent }), snapshot(), none)),
    ).toBe(0);
    expect(
      weakenedCount(compareSnapshots(snapshot(), snapshot({ flags: absent, laws: absent }), none)),
    ).toBe(2);
  });
});
