import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PROFILES, type Profile } from "./profiles.ts";
import { PROTOCOL } from "./protocol.ts";
import { runSemanticChecks } from "./semantic.ts";
import { containing } from "./test-support.ts";
import type { Enforce, WebTopsConfig } from "./types.ts";

type Gates = NonNullable<WebTopsConfig["gates"]>;

function config(profile: Profile, enforce: Enforce, gates: Gates): WebTopsConfig {
  return {
    protocol: PROTOCOL,
    version: "0.1.0",
    package: "pkg",
    class: profile.class,
    enforce,
    baseline: ".web-tops/baseline.json",
    exemption: { until: "2099-12-31", reason: "a test" },
    gates,
    report: { path: ".web-tops/report.json" },
  };
}

function problemsAt(value: WebTopsConfig, pointer: string): readonly string[] {
  return runSemanticChecks(value, {
    cwd: process.cwd(),
    today: "2026-11-17",
    project: { dependsOnAstro: false },
  })
    .filter((problem) => problem.pointer === pointer)
    .map((problem) => problem.message);
}

const FLOOR = "/gates/coverage/lines_floor";
const CAP = "/gates/crap/cap";
const SURVIVORS = "/gates/mutation/unexplained_survivors_max";

const floorOf = (lines_floor: number): Gates => ({ coverage: { lines_floor } });
const capOf = (cap: number): Gates => ({ crap: { cap } });
const survivorsOf = (unexplained_survivors_max: number): Gates => ({
  mutation: { unexplained_survivors_max },
});

describe("G3b: under hard, a floor or cap looser than the class profile is refused", () => {
  const classes = PROFILES.map((profile) => profile.class);

  it.each(classes)("%s: a coverage floor below the profile's, at its pointer", (name) => {
    const profile = PROFILES.find((candidate) => candidate.class === name);
    if (profile === undefined) throw new Error(name);
    expect(problemsAt(config(profile, "hard", floorOf(profile.linesFloor - 1)), FLOOR)).toEqual([
      containing(String(profile.linesFloor)),
    ]);
  });

  it.each(classes)("%s: a CRAP cap above the profile's, at its pointer", (name) => {
    const profile = PROFILES.find((candidate) => candidate.class === name);
    if (profile === undefined) throw new Error(name);
    expect(problemsAt(config(profile, "hard", capOf(profile.crapCap + 1)), CAP)).toEqual([
      containing(String(profile.crapCap)),
    ]);
  });

  it.each(classes)("%s: more unexplained survivors than the profile allows", (name) => {
    const profile = PROFILES.find((candidate) => candidate.class === name);
    if (profile === undefined) throw new Error(name);
    const loose = config(profile, "hard", survivorsOf(profile.unexplainedSurvivorsMax + 1));
    expect(problemsAt(loose, SURVIVORS)).toHaveLength(1);
  });

  it.each(classes)("%s: the profile's own values, stricter values and no key all pass", (name) => {
    const profile = PROFILES.find((candidate) => candidate.class === name);
    if (profile === undefined) throw new Error(name);
    const gates: readonly Gates[] = [
      {},
      {
        coverage: { lines_floor: profile.linesFloor },
        crap: { cap: profile.crapCap },
        mutation: { unexplained_survivors_max: profile.unexplainedSurvivorsMax },
      },
      {
        coverage: { lines_floor: 100 },
        crap: { cap: 1 },
        mutation: { unexplained_survivors_max: 0 },
      },
    ];
    for (const entry of gates) {
      const value = config(profile, "hard", entry);
      for (const pointer of [FLOOR, CAP, SURVIVORS]) expect(problemsAt(value, pointer)).toEqual([]);
    }
  });

  it.each(["ratchet", "advisory"] as const)(
    "%s keeps a looser floor, cap and survivors limit",
    (enforce) => {
      for (const profile of PROFILES) {
        const gates: Gates = {
          coverage: { lines_floor: 1 },
          crap: { cap: 99 },
          mutation: { unexplained_survivors_max: 99 },
        };
        const value = config(profile, enforce, gates);
        for (const pointer of [FLOOR, CAP])
          expect(problemsAt(value, pointer), profile.class).toEqual([]);
        if (profile.class !== "ts-library") expect(problemsAt(value, SURVIVORS)).toEqual([]);
      }
    },
  );

  it("does not hold a gate that is switched off to the profile's cap or survivors", () => {
    for (const profile of PROFILES) {
      const off: Gates = {
        crap: { enabled: false, reason: "M2", cap: 99 },
        mutation: { enabled: false, reason: "M2", unexplained_survivors_max: 99 },
      };
      const value = config(profile, "hard", off);
      expect(problemsAt(value, CAP), profile.class).toEqual([]);
      expect(problemsAt(value, SURVIVORS), profile.class).toEqual([]);
    }
  });

  it("holds for any floor, cap and survivors limit: refused exactly when looser (property)", () => {
    const profiles = fc.constantFrom(...PROFILES);
    fc.assert(
      fc.property(profiles, fc.integer({ min: 0, max: 100 }), (profile, floor) => {
        const refused = problemsAt(config(profile, "hard", floorOf(floor)), FLOOR).length > 0;
        expect(refused).toBe(floor < profile.linesFloor);
      }),
    );
    fc.assert(
      fc.property(profiles, fc.integer({ min: 1, max: 30 }), (profile, cap) => {
        const refused = problemsAt(config(profile, "hard", capOf(cap)), CAP).length > 0;
        expect(refused).toBe(cap > profile.crapCap);
      }),
    );
    fc.assert(
      fc.property(profiles, fc.integer({ min: 0, max: 9 }), (profile, max) => {
        const refused = problemsAt(config(profile, "hard", survivorsOf(max)), SURVIVORS).length > 0;
        expect(refused).toBe(max > profile.unexplainedSurvivorsMax);
      }),
    );
  });
});
