import { describe, expect, it } from "vitest";
import { validateReport } from "../config/report.ts";
import type { Report } from "../report/types.ts";
import { buildRegistry } from "./registry.ts";
import { runGate } from "./runner.ts";
import { cfg, fakeBuiltins, fakeLayer, noExec, off, opts, tickingClock } from "./testkit.ts";
import type { GateConfig, GateOptions, Layer } from "./types.ts";

/** G1d: laws run at the tier of the layer they read, and a stopped run still judges what ran (R49). */

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

function entryOf(report: Report, id: string): Report["layers"][number] {
  const found = report.layers.find((layer) => layer.id === id);
  if (found === undefined) {
    throw new Error(`no layer ${id} in the report`);
  }
  return found;
}

describe("G1d laws run at the tier of the layer they read", () => {
  it("the registered laws layer is tier 1: it reads hygiene, and hygiene is tier 1", () => {
    const laws = buildRegistry(cfg()).find((layer) => layer.id === "laws");
    expect(laws).toMatchObject({ gate: "laws", tier: 1, requires: ["hygiene"] });
  });

  it("--max-tier 0 puts the laws layer out of range, like every other tier-1 layer", async () => {
    const calls: string[] = [];
    const report = await run(fakeBuiltins(calls), cfg(), opts({ maxTier: 0 }));
    expect(calls).toEqual([]);
    expect(entryOf(report, "laws")).toMatchObject({
      verdict: "skip",
      reason: "tier 1 is above --max-tier 0",
    });
    expect(report.exit_code).toBe(1);
  });

  it("a tier-0 layer still runs under --max-tier 0", async () => {
    const calls: string[] = [];
    const floor = fakeLayer({ id: "floor", gate: 6, tier: 0, calls });
    const report = await run([...fakeBuiltins([]), floor], cfg(), opts({ maxTier: 0 }));
    expect(calls).toEqual(["floor"]);
    expect(report.exit_code).toBe(0);
  });
});

describe("G1d a stopped run still judges what ran with the laws layer", () => {
  it("runs the laws layer after tests failed, and counts it as ran", async () => {
    const calls: string[] = [];
    const report = await run(fakeBuiltins(calls, { tests: "fail" }));
    expect(calls).toEqual(["hygiene", "tests", "laws"]);
    expect(entryOf(report, "coverage")).toMatchObject({
      verdict: "not-run",
      reason: "stopped: gate 2 failed",
    });
    expect(entryOf(report, "laws").verdict).toBe("pass");
    expect(report.counts).toEqual({ in_range: 7, ran: 3, failed: 5, not_evaluated: 0 });
    expect(report.exit_code).toBe(1);
    expect(validateReport(report).ok).toBe(true);
  });

  it("runs it after hygiene failed too: hygiene ran, and its findings are what laws read", async () => {
    const calls: string[] = [];
    const report = await run(fakeBuiltins(calls, { hygiene: "fail" }));
    expect(calls).toEqual(["hygiene", "laws"]);
    expect(entryOf(report, "tests").reason).toBe("stopped: gate 1 failed");
    expect(entryOf(report, "laws").verdict).toBe("pass");
    expect(report.exit_code).toBe(1);
  });

  it("a laws failure on a stopped run is reported, and the run stays failed", async () => {
    const calls: string[] = [];
    const report = await run(fakeBuiltins(calls, { tests: "fail", laws: "refuse" }));
    expect(entryOf(report, "laws").verdict).toBe("refuse");
    expect(report.counts.failed).toBe(6);
    expect(report.exit_code).toBe(1);
  });

  it("does not run it when hygiene did not run: the stop applies, as to every other layer", async () => {
    const calls: string[] = [];
    const layers = fakeBuiltins(calls, { tests: "fail" });
    const report = await run(layers, cfg({ toggles: { hygiene: off("off for the test") } }));
    expect(calls).toEqual(["tests"]);
    expect(entryOf(report, "laws")).toMatchObject({
      verdict: "not-run",
      reason: "stopped: gate 2 failed",
    });
  });

  it("only the laws layer is exempt: a custom layer after the stop is still not-run", async () => {
    const calls: string[] = [];
    const layers = [
      ...fakeBuiltins(calls, { tests: "fail" }),
      fakeLayer({ id: "extra", gate: 6, calls }),
    ];
    const report = await run(layers);
    expect(calls).not.toContain("extra");
    expect(entryOf(report, "extra").reason).toBe("stopped: gate 2 failed");
  });

  it("without a stop the laws layer runs last, as before", async () => {
    const calls: string[] = [];
    await run(fakeBuiltins(calls));
    expect(calls.at(-1)).toBe("laws");
  });
});
