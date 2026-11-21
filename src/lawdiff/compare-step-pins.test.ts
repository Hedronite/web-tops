import { describe, expect, it } from "vitest";
import { compareSnapshots } from "./compare.ts";
import type { Cruise, Part, Snapshot } from "./types.ts";

const absent: Part<never> = { state: "absent" };

const snapshot = (cruise: Cruise): Snapshot => ({
  tracked: [],
  trackedStyle: [],
  levels: absent,
  style: absent,
  cruise: { state: "ok", value: cruise },
  fileSets: absent,
  flags: absent,
  settings: absent,
  laws: absent,
  profile: absent,
  tools: absent,
});

const cruise = (allowed: string[], excluded: string[]): Cruise => ({
  values: new Map([
    ["forbidden: a", { shown: "error", rank: 3 }],
    ["forbidden: b", { shown: "warn", rank: 2 }],
  ]),
  allowed,
  excluded,
});

const surfaceOf = (base: Cruise, head: Cruise) =>
  compareSnapshots(snapshot(base), snapshot(head), new Map()).filter((surface) =>
    surface.name.startsWith("dependency-cruiser"),
  );

describe("the dependency-cruiser surface", () => {
  it("counts the named rules and each allowed and each left out entry of the base as compared", () => {
    const same = cruise(["x", "y"], ["exclude: z"]);
    expect(surfaceOf(same, same).map((surface) => surface.compared)).toEqual([5]);
    expect(surfaceOf(cruise([], []), cruise([], [])).map((surface) => surface.compared)).toEqual([
      2,
    ]);
    expect(
      surfaceOf(cruise(["x"], []), cruise(["x"], [])).map((surface) => surface.compared),
    ).toEqual([3]);
    expect(
      surfaceOf(cruise([], ["e"]), cruise([], ["e"])).map((surface) => surface.compared),
    ).toEqual([3]);
  });
});
