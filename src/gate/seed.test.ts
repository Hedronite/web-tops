import { describe, expect, it } from "vitest";
import { validateReport } from "../config/report.ts";
import { runGate } from "./runner.ts";
import { cfg, fakeBuiltins, fakeLayer, noExec, opts, tickingClock } from "./testkit.ts";
import type { Layer } from "./types.ts";

/** R29 N7: the tests layer records the shuffle seed on its entry; the schema allows an integer `seed` and nothing else new. */

function report(layers: readonly Layer[]): ReturnType<typeof runGate> {
  return runGate({
    layers,
    config: cfg(),
    options: opts(),
    cwd: "/unused",
    env: {},
    exec: noExec,
    outDir: "/unused/.web-tops/out",
    now: tickingClock(),
  });
}

/** Every built-in layer, with the tests layer carrying `seed` (the schema wants all of them). */
function builtins(seed?: number): Layer[] {
  const others = fakeBuiltins([]).filter((layer) => layer.id !== "tests");
  return [...others, fakeLayer({ id: "tests", gate: 2, ...(seed === undefined ? {} : { seed }) })];
}

describe("G4d seed: an optional integer on a layer entry", () => {
  it("copies a layer's seed to its report entry, and leaves the key out when it has none", async () => {
    const ran = await report([
      fakeLayer({ id: "hygiene", gate: 1 }),
      fakeLayer({ id: "tests", gate: 2, seed: 4242 }),
    ]);
    expect(ran.layers.find((layer) => layer.id === "tests")).toMatchObject({ seed: 4242 });
    expect(ran.layers.find((layer) => layer.id === "hygiene")).not.toHaveProperty("seed");
  });

  it("writes a report the schema accepts, with and without a seed", async () => {
    expect(validateReport(await report(builtins(7))).ok).toBe(true);
    expect(validateReport(await report(builtins())).ok).toBe(true);
  });

  it.each([
    ["a fraction", 1.5],
    ["a negative number", -1],
    ["text", "7"],
  ])("the schema refuses a seed that is %s", async (_label, seed) => {
    const ran = await report(builtins(7));
    expect(validateReport(ran).ok).toBe(true);
    const bad = { ...ran, layers: ran.layers.map((layer) => ({ ...layer, seed })) };
    expect(validateReport(bad).ok).toBe(false);
  });

  it("keeps additionalProperties false on a layer entry: another new key is still refused", async () => {
    const ran = await report(builtins());
    expect(validateReport(ran).ok).toBe(true);
    const bad = { ...ran, layers: ran.layers.map((layer) => ({ ...layer, extra: 1 })) };
    expect(validateReport(bad).ok).toBe(false);
  });
});
