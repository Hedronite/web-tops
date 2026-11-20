import { describe, expect, it } from "vitest";
import { planGate } from "./plan.ts";
import { cfg, fakeLayer, opts } from "./testkit.ts";
import type { GateConfig } from "./types.ts";

/** The plan's edges: a switch with no reason, layers that require each other, and ids nothing registers. */

const enabled = (id: string): GateConfig => cfg({ toggles: { [id]: { enabled: true } } });

describe("the reason a layer is skipped", () => {
  it("is the config's own words, and says so when the config gave none", () => {
    const layers = [fakeLayer({ id: "hygiene" })];
    const bare = cfg({ toggles: { hygiene: { enabled: false } } });
    expect(planGate(layers, bare, opts())[0]?.skip).toBe("disabled in web-tops.yaml");
    const said = cfg({ toggles: { hygiene: { enabled: false, reason: "lands later" } } });
    expect(planGate(layers, said, opts())[0]?.skip).toBe("lands later");
  });
});

describe("--only follows what a layer requires", () => {
  it("ends when two layers require each other", () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1, requires: ["tests"] }),
      fakeLayer({ id: "tests", gate: 2, requires: ["hygiene"] }),
      fakeLayer({ id: "coverage", gate: 3 }),
    ];
    const plan = planGate(layers, cfg(), opts({ only: "hygiene" }));
    expect(plan.map((item) => [item.id, item.skip, item.requiredBy])).toEqual([
      ["hygiene", undefined, undefined],
      ["tests", undefined, "hygiene"],
      ["coverage", "not selected by --only hygiene", undefined],
    ]);
  });

  it("pulls a layer in once, by the first that needs it", () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1 }),
      fakeLayer({ id: "tests", gate: 2, requires: ["hygiene"] }),
      fakeLayer({ id: "coverage", gate: 3, requires: ["tests", "hygiene"] }),
    ];
    const plan = planGate(layers, cfg(), opts({ only: "coverage" }));
    expect(plan.map((item) => item.requiredBy)).toEqual(["coverage", "coverage", undefined]);
  });

  it("names a layer nothing registers and pulls nothing else in", () => {
    const layers = [fakeLayer({ id: "hygiene", gate: 1 })];
    const plan = planGate(layers, cfg(), opts({ only: "ghost" }));
    expect(plan.map((item) => [item.id, item.skip])).toEqual([
      ["hygiene", "not selected by --only ghost"],
    ]);
  });
});

describe("an id the config enables and nothing registers", () => {
  const layers = [fakeLayer({ id: "hygiene", gate: 1 })];

  it("is in the plan as a layer of its own, and not when --only picks a layer", () => {
    expect(planGate(layers, enabled("ghost"), opts()).map((item) => item.id)).toEqual([
      "hygiene",
      "ghost",
    ]);
    expect(
      planGate(layers, enabled("ghost"), opts({ only: "hygiene" })).map((item) => item.id),
    ).toEqual(["hygiene"]);
  });

  it("is skipped for the reason any layer would be, such as a tier above the one asked", () => {
    const plan = planGate(layers, enabled("ghost"), opts({ maxTier: 0 }));
    expect(plan.find((item) => item.id === "ghost")?.skip).toBe("tier 1 is above --max-tier 0");
  });
});
