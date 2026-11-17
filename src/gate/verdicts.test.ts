import { describe, expect, it } from "vitest";
import { VERDICTS, type Verdict } from "../report/types.ts";
import { cfg, fakeBuiltins, fakeLayer, noExec, opts, tickingClock } from "./testkit.ts";
import { buildRegistry } from "./registry.ts";
import { runGate } from "./runner.ts";
import type { GateConfig, GateOptions, Layer } from "./types.ts";

function run(layers: readonly Layer[], config: GateConfig = cfg(), options: GateOptions = opts()) {
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

describe("G2b runner: not-run fails, a short layer count fails, not-evaluated never passes", () => {
  it.each(VERDICTS)(
    "a layer that returns %s decides the exit code on its own",
    async (verdict: Verdict) => {
      const layers = [
        fakeLayer({ id: "hygiene", gate: 1 }),
        fakeLayer({ id: "tests", gate: 2, verdict, reason: "because" }),
      ];
      const report = await run(layers, cfg(), opts({ keepGoing: true }));
      const passes = verdict === "pass" || verdict === "skip";
      expect(report.exit_code).toBe(passes ? 0 : 1);
      expect(report.passed).toBe(passes);
    },
  );

  it("fails an enabled custom layer that has no command as not-run", async () => {
    const config = cfg({ custom: [{ id: "budgets", tier: 1 }] });
    const report = await run(buildRegistry(config), config, opts({ keepGoing: true }));
    expect(report.layers.find((layer) => layer.id === "budgets")).toMatchObject({
      verdict: "not-run",
      reason: "no command is mapped to this layer",
    });
    expect(report.exit_code).toBe(1);
  });

  it("fails when the config enables a layer the run never reached: ran 6 of 7", async () => {
    const six = fakeBuiltins([]).filter((layer) => layer.id !== "crap");
    const config = cfg({ toggles: { crap: { enabled: true } } });
    const report = await run(six, config);
    expect(report.counts).toEqual({ in_range: 7, ran: 6, failed: 1, not_evaluated: 0 });
    expect(report.problems).toEqual([
      { path: "/counts/ran", message: "ran 6 of 7 layers in range" },
    ]);
    expect(report.layers.find((layer) => layer.id === "crap")).toMatchObject({
      verdict: "not-run",
      reason: "no layer is registered for this id",
    });
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(1);
  });

  it("never counts not-evaluated as a pass, and counts it on its own", async () => {
    const calls: string[] = [];
    const report = await run(
      fakeBuiltins(calls, { coverage: "not-evaluated" }),
      cfg(),
      opts({ keepGoing: true }),
    );
    expect(report.counts.not_evaluated).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(1);
    expect(calls).toHaveLength(7);
  });

  it("fails a run in which nothing was enabled in range: an empty run is not a pass", async () => {
    const report = await run(fakeBuiltins([]), cfg(), opts({ only: "nothing" }));
    expect(report.counts.in_range).toBe(0);
    expect(report.problems).toEqual([{ path: "/counts/in_range", message: "no layer ran" }]);
    expect(report.exit_code).toBe(1);
  });

  it("turns a throwing layer into not-evaluated with the error text, and keeps going if asked", async () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1, throws: new Error("disk on fire") }),
      fakeLayer({ id: "tests", gate: 2 }),
    ];
    const report = await run(layers, cfg(), opts({ keepGoing: true }));
    expect(report.layers[0]).toMatchObject({
      verdict: "not-evaluated",
      reason: "layer threw: disk on fire",
    });
    expect(report.counts.ran).toBe(2);
    expect(report.exit_code).toBe(1);
  });

  it("reports advisory runs as not enforced and exits 0 with the verdicts kept", async () => {
    const report = await run(
      fakeBuiltins([], { tests: "Refuse" }),
      cfg({ enforce: "advisory" }),
      opts({ keepGoing: true }),
    );
    expect(report.enforced).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(0);
    expect(report.layers.find((layer) => layer.id === "tests")?.verdict).toBe("Refuse");
  });

  it("turns a skip with no reason into not-evaluated: a skip must say why", async () => {
    const report = await run([fakeLayer({ id: "hygiene", verdict: "skip" })]);
    expect(report.layers[0]).toMatchObject({
      verdict: "not-evaluated",
      reason: "layer returned skip without a reason",
    });
    expect(report.exit_code).toBe(1);
  });

  it("counts a layer as ran only when it returns an evaluated verdict; a layer that skips itself leaves the range", async () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1 }),
      fakeLayer({ id: "tests", gate: 2, verdict: "not-run", reason: "no command" }),
      fakeLayer({ id: "coverage", gate: 3, verdict: "skip", reason: "not needed" }),
      fakeLayer({ id: "crap", gate: 4, verdict: "Ack" }),
      fakeLayer({ id: "mutation", gate: 5, verdict: "not-evaluated", reason: "no judge" }),
    ];
    const report = await run(layers, cfg(), opts({ keepGoing: true }));
    expect(report.counts).toEqual({ in_range: 4, ran: 3, failed: 2, not_evaluated: 1 });
    expect(report.problems).toEqual([
      { path: "/counts/ran", message: "ran 3 of 4 layers in range" },
    ]);
    expect(report.passed).toBe(false);
  });

  it("shows ran 0 for a run in which every layer is a stub or never reached", async () => {
    const stopped = await run(
      [
        fakeLayer({ id: "hygiene", gate: 1, verdict: "not-run", reason: "stub" }),
        fakeLayer({ id: "tests", gate: 2 }),
      ],
      cfg(),
    );
    expect(stopped.counts).toEqual({ in_range: 2, ran: 0, failed: 2, not_evaluated: 0 });
  });
});
