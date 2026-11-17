import { describe, expect, it } from "vitest";
import { formatText } from "../report/text.ts";
import type { Report } from "../report/types.ts";
import { cfg, fakeBuiltins, fakeLayer, noExec, off, opts, tickingClock } from "./testkit.ts";
import { runGate } from "./runner.ts";
import type { GateConfig, GateOptions, Layer, LayerContext } from "./types.ts";

function run(
  layers: readonly Layer[],
  config: GateConfig = cfg(),
  options: GateOptions = opts(),
): Promise<Report> {
  return runGate({
    layers,
    config,
    options,
    cwd: "/unused",
    env: {},
    exec: noExec,
    outDir: "/unused/.web-tops/out",
    now: tickingClock(),
  });
}

const ORDER = ["hygiene", "tests", "coverage", "crap", "mutation", "build-output", "laws"];

describe("G2a runner: §3.1 order, stop on failure, --keep-going, --max-tier, --only, --base, --json", () => {
  it("runs the layers in gate order whatever order they were registered in", async () => {
    const calls: string[] = [];
    const shuffled = fakeBuiltins(calls).reverse();
    const report = await run(shuffled);
    expect(calls).toEqual(ORDER);
    expect(report.layers.map((layer) => layer.id)).toEqual(ORDER);
    expect(report.passed).toBe(true);
    expect(report.exit_code).toBe(0);
  });

  it("stops at the first failing gate and reports the layers it never reached as not-run", async () => {
    const calls: string[] = [];
    const report = await run(fakeBuiltins(calls, { tests: "Refuse" }));
    expect(calls).toEqual(["hygiene", "tests"]);
    const byId = new Map(report.layers.map((layer) => [layer.id, layer]));
    expect(byId.get("coverage")).toMatchObject({
      verdict: "not-run",
      reason: "stopped: gate 2 failed",
    });
    expect(byId.get("laws")).toMatchObject({
      verdict: "not-run",
      reason: "stopped: gate 2 failed",
    });
    expect(report.counts).toEqual({ in_range: 7, ran: 2, failed: 6, not_evaluated: 0 });
    expect(report.exit_code).toBe(1);
  });

  it("runs every layer under --keep-going and still fails", async () => {
    const calls: string[] = [];
    const report = await run(
      fakeBuiltins(calls, { tests: "Refuse" }),
      cfg(),
      opts({ keepGoing: true }),
    );
    expect(calls).toEqual(ORDER);
    expect(report.counts.ran).toBe(7);
    expect(report.keep_going).toBe(true);
    expect(report.exit_code).toBe(1);
  });

  it("names the layer that stopped the run, including laws", async () => {
    const calls: string[] = [];
    const layers = [
      ...fakeBuiltins(calls, { hygiene: "Refuse" }),
      fakeLayer({ id: "extra", gate: 6, calls }),
    ];
    const report = await run(layers);
    expect(report.layers.find((layer) => layer.id === "extra")?.reason).toBe(
      "stopped: gate 1 failed",
    );
    const lawsFirst = await run(fakeBuiltins([], { laws: "Refuse" }), cfg(), opts({ maxTier: 0 }));
    expect(lawsFirst.exit_code).toBe(1);
  });

  it("filters by --max-tier: a tier-2 layer is skipped by default and runs at --max-tier 2", async () => {
    const calls: string[] = [];
    const layers = [...fakeBuiltins(calls), fakeLayer({ id: "nightly", gate: 6, tier: 2, calls })];
    const byDefault = await run(layers);
    expect(calls).not.toContain("nightly");
    expect(byDefault.layers.find((layer) => layer.id === "nightly")).toMatchObject({
      verdict: "skip",
      reason: "tier 2 is above --max-tier 1",
    });
    expect(byDefault.counts.in_range).toBe(7);
    calls.length = 0;
    const deep = await run(layers, cfg(), opts({ maxTier: 2 }));
    expect(calls).toContain("nightly");
    expect(deep.counts.in_range).toBe(8);
  });

  it("--max-tier 0 runs only the tier-0 layers", async () => {
    const calls: string[] = [];
    await run(fakeBuiltins(calls), cfg(), opts({ maxTier: 0 }));
    expect(calls).toEqual(["laws"]);
  });

  it("--only runs the named layer and what it requires, and skips the rest with a reason", async () => {
    const calls: string[] = [];
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1, calls }),
      fakeLayer({ id: "tests", gate: 2, calls }),
      fakeLayer({ id: "coverage", gate: 3, calls, requires: ["tests"] }),
      fakeLayer({ id: "crap", gate: 4, calls }),
    ];
    const report = await run(layers, cfg(), opts({ only: "coverage" }));
    expect(calls).toEqual(["tests", "coverage"]);
    expect(report.only).toBe("coverage");
    expect(report.layers.find((layer) => layer.id === "tests")?.reason).toBe(
      "required by coverage",
    );
    expect(report.layers.find((layer) => layer.id === "coverage")?.reason).toBeUndefined();
    expect(formatText(report)).toContain("tests (required by coverage)");
    expect(report.layers.find((layer) => layer.id === "crap")).toMatchObject({
      verdict: "skip",
      reason: "not selected by --only coverage",
    });
    expect(report.counts).toEqual({ in_range: 2, ran: 2, failed: 0, not_evaluated: 0 });
    expect(report.passed).toBe(true);
    expect(report.exit_code).toBe(0);
    expect((await run(layers)).only).toBeNull();
  });

  it("hands each layer --base, else gates.mutation.base, else origin/main", async () => {
    const seen: string[] = [];
    const probe = (): Layer => ({
      ...fakeLayer({ id: "hygiene" }),
      run: (context: LayerContext) => {
        seen.push(context.base);
        return Promise.resolve({ verdict: "pass", findings: [], artifacts: {} });
      },
    });
    await run([probe()], cfg(), opts({ base: "release" }));
    await run([probe()], cfg({ base: "develop" }));
    await run([probe()], cfg());
    await run([probe()], cfg({ base: "develop" }), opts({ base: "release" }));
    expect(seen).toEqual(["release", "develop", "origin/main", "release"]);
  });

  it("skips a disabled layer with its reason, and a layer the class does not map", async () => {
    const calls: string[] = [];
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1, calls }),
      fakeLayer({ id: "crap", gate: 4, calls }),
      fakeLayer({ id: "build-output", gate: 6, calls, classes: ["astro-site"] }),
    ];
    const report = await run(layers, cfg({ toggles: { crap: off("M2: native CRAP") } }));
    expect(calls).toEqual(["hygiene"]);
    expect(report.layers.find((layer) => layer.id === "crap")).toMatchObject({
      verdict: "skip",
      reason: "M2: native CRAP",
    });
    expect(report.layers.find((layer) => layer.id === "build-output")).toMatchObject({
      verdict: "skip",
      reason: "class ts-library does not map this layer",
    });
    expect(report.counts.in_range).toBe(1);
  });

  it("records each layer's duration from the clock", async () => {
    const report = await run([fakeLayer({ id: "hygiene" })]);
    expect(report.layers[0]?.duration_ms).toBeGreaterThan(0);
  });

  it("keeps a pulled-in layer's own reason and adds who required it", async () => {
    const layers = [
      fakeLayer({ id: "tests", gate: 2, verdict: "Refuse", reason: "a test failed" }),
      fakeLayer({ id: "coverage", gate: 3, requires: ["tests"] }),
    ];
    const report = await run(layers, cfg(), opts({ only: "coverage", keepGoing: true }));
    expect(report.layers.find((layer) => layer.id === "tests")?.reason).toBe(
      "a test failed (required by coverage)",
    );
    expect(formatText(report)).toContain("tests (required by coverage)");
  });
});
