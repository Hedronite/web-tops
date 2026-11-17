import { describe, expect, it } from "vitest";
import { validateReport } from "../config/report.ts";
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

/**
 * Section 3.3 for a layer that returns each verdict beside six passing ones, run with --keep-going. A layer that
 * returns `skip` is in range, so it cannot leave it: the runner makes that `not-evaluated`. Every item is
 * required until G3's profiles land, so `not-evaluated` ends the run.
 */
const OUTCOMES = {
  pass: { exit: 0, ran: 7, failed: 0, notEvaluated: 0 },
  fail: { exit: 1, ran: 7, failed: 1, notEvaluated: 0 },
  refuse: { exit: 1, ran: 7, failed: 1, notEvaluated: 0 },
  "ack-missing": { exit: 1, ran: 7, failed: 1, notEvaluated: 0 },
  skip: { exit: 1, ran: 7, failed: 1, notEvaluated: 1 },
  "not-run": { exit: 1, ran: 6, failed: 1, notEvaluated: 0 },
  "not-evaluated": { exit: 1, ran: 7, failed: 1, notEvaluated: 1 },
  vacuous: { exit: 0, ran: 7, failed: 0, notEvaluated: 0 },
} as const satisfies Record<
  Verdict,
  { exit: 0 | 1; ran: number; failed: number; notEvaluated: number }
>;

describe("G2b runner: not-run fails, a short layer count fails, not-evaluated never passes", () => {
  it.each(VERDICTS)(
    "a layer that returns %s decides the exit code and the counts as section 3.3 says",
    async (verdict: Verdict) => {
      const layers = fakeBuiltins([], { tests: verdict });
      const report = await run(layers, cfg(), opts({ keepGoing: true }));
      const want = OUTCOMES[verdict];
      expect(report.exit_code).toBe(want.exit);
      expect(report.passed).toBe(want.exit === 0);
      expect(report.counts).toMatchObject({
        ran: want.ran,
        failed: want.failed,
        not_evaluated: want.notEvaluated,
      });
      expect(validateReport(report).ok).toBe(true);
    },
  );

  it("stops the run on a verdict that ends it, and goes on past a vacuous one", async () => {
    for (const verdict of VERDICTS) {
      const calls: string[] = [];
      const layers = [
        fakeLayer({ id: "hygiene", gate: 1, verdict, reason: "because", calls }),
        fakeLayer({ id: "tests", gate: 2, calls }),
      ];
      await run(layers);
      const stops = verdict !== "pass" && verdict !== "vacuous";
      expect(calls, verdict).toEqual(stops ? ["hygiene"] : ["hygiene", "tests"]);
    }
  });

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

  it("turns a throwing layer into fail with the error text, and keeps going if asked", async () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1, throws: new Error("disk on fire") }),
      fakeLayer({ id: "tests", gate: 2 }),
    ];
    const report = await run(layers, cfg(), opts({ keepGoing: true }));
    expect(report.layers[0]).toMatchObject({
      verdict: "fail",
      reason: "layer threw: disk on fire",
    });
    expect(report.counts.ran).toBe(2);
    expect(report.exit_code).toBe(1);
  });

  it("reports advisory runs as not enforced and exits 0 with the verdicts kept", async () => {
    const report = await run(
      fakeBuiltins([], { tests: "fail" }),
      cfg({ enforce: "advisory" }),
      opts({ keepGoing: true }),
    );
    expect(report.enforced).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(0);
    expect(report.layers.find((layer) => layer.id === "tests")?.verdict).toBe("fail");
  });

  it("counts a layer as ran only when it returns an evaluated verdict: a not-run result is not ran", async () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1 }),
      fakeLayer({ id: "tests", gate: 2, verdict: "not-run", reason: "no command" }),
      fakeLayer({ id: "crap", gate: 4, verdict: "ack-missing" }),
      fakeLayer({ id: "mutation", gate: 5, verdict: "not-evaluated", reason: "no judge" }),
    ];
    const report = await run(layers, cfg(), opts({ keepGoing: true }));
    expect(report.counts).toEqual({ in_range: 4, ran: 3, failed: 3, not_evaluated: 1 });
    expect(report.problems).toEqual([
      { path: "/counts/ran", message: "ran 3 of 4 layers in range" },
    ]);
    expect(report.passed).toBe(false);
  });

  it("does not let an in-range layer leave the range by returning skip: it becomes not-evaluated and fails", async () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1 }),
      fakeLayer({ id: "tests", gate: 2, verdict: "skip", reason: "nothing to do here" }),
    ];
    const report = await run(layers);
    expect(report.counts).toEqual({ in_range: 2, ran: 2, failed: 1, not_evaluated: 1 });
    expect(report.layers.find((layer) => layer.id === "tests")).toMatchObject({
      verdict: "not-evaluated",
      reason: "skip returned by an in-range layer",
    });
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(1);
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
