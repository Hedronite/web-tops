import { describe, expect, it } from "vitest";
import { compareSnapshots } from "./compare.ts";
import { notCompared } from "./settings.ts";
import type { Part, Snapshot } from "./types.ts";

const absent: Part<never> = { state: "absent" };

const snapshot = (settings: Snapshot["settings"]): Snapshot => ({
  tracked: [],
  trackedStyle: [],
  style: absent,
  cruise: absent,
  fileSets: absent,
  levels: absent,
  flags: absent,
  settings,
  laws: absent,
  profile: absent,
  tools: absent,
});

const noteOf = (settings: Snapshot["settings"]): string | undefined =>
  compareSnapshots(snapshot(settings), snapshot(settings), new Map()).flatMap((surface) =>
    surface.name.startsWith("gate settings") ? [surface.note ?? "no note"] : [],
  )[0];

describe("the note of the settings surface", () => {
  it("is what is not compared, alone, when the settings were compared", () => {
    expect(noteOf({ state: "ok", value: { values: new Map(), globs: [] } })).toBe(notCompared());
  });

  it("follows the surface's own note, after a semicolon, when it has one", () => {
    expect(noteOf(absent)).toBe(`not there at either ref; ${notCompared()}`);
  });
});
