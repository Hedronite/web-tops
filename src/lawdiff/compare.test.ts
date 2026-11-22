import { describe, expect, it } from "vitest";
import { compareSnapshots, weakenedCount } from "./compare.ts";
import { compareProfiles, profileNote } from "./profile.ts";
import type { Cruise, Part, Profile, ProjectSets, Ranked, Snapshot, Surface } from "./types.ts";

const absent: Part<never> = { state: "absent" };
const none = new Map<string, string>();
const strong: Ranked = { shown: "true", rank: 1 };
const weak: Ranked = { shown: "false", rank: 0 };

const cruiseOf = (severity = 3, allowed: string[] = [], excluded: string[] = []): Cruise => ({
  values: new Map([["forbidden: no-circular", { shown: "error", rank: severity }]]),
  allowed,
  excluded,
});

const setsOf = (include: string[] = ["src"], program: string[] = ["src/a.ts"]): ProjectSets => ({
  include,
  exclude: [],
  files: [],
  references: [],
  program: new Set(program),
});

const changesAt = (surfaces: Surface[], index: number): string[] =>
  surfaces.flatMap((surface, at) => (at === index ? surface.items.map((item) => item.change) : []));

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
  trackedStyle: ["a.css"],
  style: {
    state: "ok",
    value: new Map([["a.css", new Map([["color", { level: 2, options: "[]" }]])]]),
  },
  cruise: { state: "ok", value: cruiseOf() },
  fileSets: { state: "ok", value: new Map([["tsconfig.json", setsOf()]]) },
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
      ["Stylelint rule levels and options (W-26)", 1, 0],
      ["dependency-cruiser rules (W-16, W-17, W-19)", 1, 0],
      ["tsconfig file set: include, exclude, files, references (W-04)", 2, 0],
      ["secretlint rules, allow lists and ignores (W-39)", 5, 0],
      ["knip ignores, entries, projects and rule levels (W-48)", 34, 0],
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
      [],
      [],
      [],
      [],
      [],
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

  it("weakens on a Stylelint rule turned off, and on a CSS file Stylelint no longer reaches", () => {
    const off = snapshot({
      style: {
        state: "ok",
        value: new Map([["a.css", new Map([["color", { level: 0, options: "[]" }]])]]),
      },
    });
    const turned = compareSnapshots(snapshot(), off, none)[6];
    expect(turned?.items.map((item) => [item.what, item.change])).toEqual([["color", "weakened"]]);
    expect(turned?.note).toBe("1 files, 1 rules compared");
    const ignored = snapshot({ style: { state: "ok", value: new Map() } });
    const dropped = compareSnapshots(snapshot(), ignored, none)[6];
    expect(dropped?.items.map((item) => [item.where, item.after])).toEqual([
      ["a.css", "no longer linted"],
    ]);
  });

  it("weakens on a dependency-cruiser rule lowered or removed", () => {
    const lowered = snapshot({ cruise: { state: "ok", value: cruiseOf(1) } });
    expect(changesAt(compareSnapshots(snapshot(), lowered, none), 7)).toEqual(["weakened"]);
    const removed = snapshot({
      cruise: { state: "ok", value: { values: new Map(), allowed: [], excluded: [] } },
    });
    expect(changesAt(compareSnapshots(snapshot(), removed, none), 7)).toEqual(["weakened"]);
  });

  it("weakens on a dependency-cruiser allowance added and on a path left out", () => {
    const loosened = snapshot({
      cruise: { state: "ok", value: cruiseOf(3, ["{}"], ["exclude: ^src"]) },
    });
    const surfaces = compareSnapshots(snapshot(), loosened, none);
    expect(
      surfaces
        .flatMap((surface) => (surface.name.startsWith("dependency") ? surface.items : []))
        .map((item) => [item.what, item.change, item.where]),
    ).toEqual([
      ["allowed", "weakened", "{}"],
      ["left out", "weakened", "exclude: ^src"],
    ]);
    expect(
      surfaces.flatMap((surface) =>
        surface.name.startsWith("dependency") ? [surface.compared] : [],
      ),
    ).toEqual([1]);
  });

  it("weakens on a tsconfig include dropped, and on a tracked file a project no longer holds", () => {
    const narrower = snapshot({
      tracked: ["src/a.ts"],
      fileSets: { state: "ok", value: new Map([["tsconfig.json", setsOf([], [])]]) },
    });
    const surface = compareSnapshots(snapshot(), narrower, none)[8];
    expect(surface?.items.map((item) => [item.what, item.change])).toEqual([
      ["tsconfig.json: include", "weakened"],
      ["tsconfig.json: program", "weakened"],
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
