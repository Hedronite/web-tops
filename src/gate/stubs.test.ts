import { describe, expect, it } from "vitest";
import { BUILTIN_IDS, type GateConfig } from "./types.ts";
import { cfg, noExec, off, opts, tickingClock } from "./testkit.ts";
import { buildRegistry } from "./registry.ts";
import { runGate } from "./runner.ts";
import { stubLayer } from "./stubs.ts";

function runReal(config: GateConfig, extra = stubLayer("later", 6, 1, "M4")) {
  return runGate({
    layers: [...buildRegistry(config), extra],
    config,
    options: opts({ keepGoing: true }),
    cwd: "/unused",
    env: {},
    exec: noExec,
    outDir: "/unused/.web-tops/out",
    now: tickingClock(),
  });
}

const LAWS_OFF = { laws: off("the laws layer is tested in its own files") };

describe("G2e stubs and custom layers: unbuilt stubs report not-run when enabled", () => {
  it("registers the seven built-in layers in gate order", () => {
    expect(buildRegistry(cfg()).map((layer) => layer.id)).toEqual([...BUILTIN_IDS]);
  });

  it("enabling a stub layer yields not-run naming its milestone, and a failed gate", async () => {
    const report = await runReal(
      cfg({
        toggles: {
          ...LAWS_OFF,
          "build-output": off("tested separately"),
          hygiene: off("t"),
          tests: off("t"),
          coverage: off("t"),
          crap: off("t"),
          mutation: off("t"),
        },
      }),
    );
    const layer = report.layers.find((entry) => entry.id === "later");
    expect(layer?.verdict).toBe("not-run");
    expect(layer?.reason).toContain("M4");
    expect(report.exit_code).toBe(1);
    expect(report.layers.filter((entry) => entry.verdict === "not-run")).toHaveLength(1);
    expect(report.counts.ran).toBe(0);
    expect(report.problems).toEqual([
      { path: "/counts/ran", message: "ran 0 of 1 layers in range" },
    ]);
  });

  it("build-output disabled in config is skip with the config reason, not a silent skip", async () => {
    const report = await runGate({
      layers: buildRegistry(cfg()),
      config: cfg({
        toggles: {
          ...LAWS_OFF,
          "build-output": off("build-output lands later"),
          hygiene: off("t"),
          tests: off("t"),
          coverage: off("t"),
          crap: off("t"),
        },
      }),
      options: opts({ keepGoing: true }),
      cwd: "/unused",
      env: {},
      exec: noExec,
      outDir: "/unused/.web-tops/out",
      now: tickingClock(),
    });
    expect(report.layers.find((entry) => entry.id === "build-output")).toMatchObject({
      verdict: "skip",
      reason: "build-output lands later",
    });
  });

  it("puts every built-in id in the report even when the config says nothing about it", async () => {
    const report = await runGate({
      layers: buildRegistry(cfg()),
      config: cfg(),
      options: opts({ keepGoing: true }),
      cwd: "/unused",
      env: {},
      exec: noExec,
      outDir: "/unused/.web-tops/out",
      now: tickingClock(),
    });
    expect(report.layers.map((layer) => layer.id)).toEqual([...BUILTIN_IDS]);
  });

  it("O10: buildRegistry wires the composite build-output layer instead of a not-run stub", async () => {
    const config = cfg({
      class: "ui-components",
      subLayers: { "size-limit": { enabled: false, reason: "private" } },
      toggles: {
        ...LAWS_OFF,
        hygiene: off("t"),
        tests: off("t"),
        coverage: off("t"),
        crap: off("t"),
        mutation: off("t"),
      },
    });
    const report = await runGate({
      layers: buildRegistry(config),
      config,
      options: opts({ keepGoing: true }),
      cwd: "/unused",
      env: {},
      exec: noExec,
      outDir: "/unused/.web-tops/out",
      now: tickingClock(),
    });
    const entry = report.layers.find((layer) => layer.id === "build-output");
    expect(entry?.verdict).toBe("pass");
    expect(entry?.findings.some((finding) => finding.verdict === "skip")).toBe(true);
  });

  it("a stub requires, produces and consumes nothing, unless it says what it requires", () => {
    const bare = stubLayer("later", 6, 1, "a later milestone");
    expect([bare.requires, bare.produces, bare.consumes]).toEqual([[], [], []]);
    const waiting = stubLayer("later", "laws", 1, "a later milestone", ["hygiene"]);
    expect(waiting.requires).toEqual(["hygiene"]);
  });

  it("a custom layer with a command is not-run too: custom layers are not run yet", async () => {
    const config = cfg({ custom: [{ id: "budgets", tier: 1, command: "bun run budgets" }] });
    const report = await runGate({
      layers: buildRegistry(config),
      config,
      options: opts({ keepGoing: true }),
      cwd: "/unused",
      env: {},
      exec: noExec,
      outDir: "/unused/.web-tops/out",
      now: tickingClock(),
    });
    const withEnabledKnown = cfg({
      toggles: { hygiene: { enabled: true } },
      custom: [{ id: "budgets", tier: 1, command: "bun run budgets" }],
    });
    const knownReport = await runGate({
      layers: buildRegistry(withEnabledKnown),
      config: withEnabledKnown,
      options: opts({ keepGoing: true }),
      cwd: "/unused",
      env: {},
      exec: noExec,
      outDir: "/unused/.web-tops/out",
      now: tickingClock(),
    });
    expect(knownReport.layers.filter((entry) => entry.id === "hygiene")).toHaveLength(1);

    expect(report.layers.find((entry) => entry.id === "budgets")).toMatchObject({
      verdict: "not-run",
      reason: "custom layers are not run yet",
    });
  });
});
