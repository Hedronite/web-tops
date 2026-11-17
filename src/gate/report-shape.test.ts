import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import { REPORT_VERSION, validateReport } from "../config/report.ts";
import type { Report } from "../report/types.ts";
import { toGateConfig } from "./adapter.ts";
import { runGate } from "./runner.ts";
import { cfg, fakeBuiltins, fakeLayer, noExec, opts, tickingClock } from "./testkit.ts";
import type { GateConfig, GateOptions, Layer, RunDescription } from "./types.ts";

/** G2a to G2c: the runner writes report_version, subject, run, required and metrics (WEB_TOPS.md section 6.6). */

const DESCRIPTION: RunDescription = {
  root: "packages/fixture",
  sha: "0123456789abcdef0123456789abcdef01234567",
  bun: "1.4.4",
  node: "26.12.1",
  tools: { eslint: "9.39.5", vitest: "5.1.0" },
};

function input(
  layers: readonly Layer[],
  config: GateConfig,
  options: GateOptions,
): Parameters<typeof runGate>[0] {
  return {
    layers,
    config,
    options,
    cwd: "/unused",
    env: {},
    exec: noExec,
    outDir: "/unused/.web-tops/out",
    now: tickingClock(),
  };
}

function run(
  layers: readonly Layer[],
  config: GateConfig = cfg(),
  options: GateOptions = opts(),
): Promise<Report> {
  return runGate({
    ...input(layers, config, options),
    describe: () => Promise.resolve(DESCRIPTION),
  });
}

/** A run with nothing to say about its SHA, runtimes or tools. */
function runUndescribed(layers: readonly Layer[]): Promise<Report> {
  return runGate(input(layers, cfg(), opts()));
}

function entryOf(report: Report, id: string): Report["layers"][number] {
  const found = report.layers.find((layer) => layer.id === id);
  if (found === undefined) {
    throw new Error(`no layer ${id} in the report`);
  }
  return found;
}

describe("G2a the report names its format, its subject and its run", () => {
  it("carries report_version 1.0.0, the package, the root and the run description", async () => {
    const report = await run(fakeBuiltins([]));
    expect(report.report_version).toBe(REPORT_VERSION);
    expect(report.subject).toEqual({ package: "fixture", root: "packages/fixture" });
    expect(report.run).toEqual({
      sha: DESCRIPTION.sha,
      bun: DESCRIPTION.bun,
      node: DESCRIPTION.node,
      tools: DESCRIPTION.tools,
      seed: null,
    });
    expect(validateReport(report).ok).toBe(true);
  });

  it("records the shuffle seed the tests layer passed, in run.seed and on the layer", async () => {
    const layers = fakeBuiltins([]).map((layer) =>
      layer.id === "tests" ? fakeLayer({ id: "tests", gate: 2, seed: 4242 }) : layer,
    );
    const report = await run(layers);
    expect(report.run.seed).toBe(4242);
    expect(entryOf(report, "tests").seed).toBe(4242);
  });

  it("without a description the run is still a valid report: nothing could be read, so null and empty", async () => {
    const report = await runUndescribed(fakeBuiltins([]));
    expect(report.subject).toEqual({ package: "fixture", root: "." });
    expect(report.run).toEqual({ sha: null, bun: null, node: null, tools: {}, seed: null });
    expect(validateReport(report).ok).toBe(true);
  });
});

describe("G2b required comes from the class profile", () => {
  it("every layer is required unless the config's optional list names it", async () => {
    const report = await run(fakeBuiltins([]), cfg({ optionalLayers: ["laws"] }));
    expect(report.layers.map((layer) => [layer.id, layer.required])).toEqual([
      ["hygiene", true],
      ["tests", true],
      ["coverage", true],
      ["crap", true],
      ["mutation", true],
      ["build-output", true],
      ["laws", false],
    ]);
  });

  it("a skipped or not-run layer carries required too, and a custom layer is required", async () => {
    const config = cfg({
      optionalLayers: ["crap"],
      toggles: { mutation: { enabled: false, reason: "M2" } },
      custom: [{ id: "budgets", tier: 1 }],
    });
    const layers = [...fakeBuiltins([]), fakeLayer({ id: "budgets", gate: 6 })];
    const report = await run(layers, config);
    expect(entryOf(report, "mutation")).toMatchObject({ verdict: "skip", required: true });
    expect(entryOf(report, "crap").required).toBe(false);
    expect(entryOf(report, "budgets").required).toBe(true);
  });

  it("a not-evaluated layer ends the run when required, and does not when it is not", async () => {
    const required = await run(fakeBuiltins([], { laws: "not-evaluated" }));
    expect(required.counts).toEqual({
      in_range: 7,
      ran: 7,
      failed: 1,
      not_evaluated: 1,
      required_not_evaluated: 1,
    });
    expect(required.passed).toBe(false);
    expect(required.exit_code).toBe(1);
    const optional = await run(
      fakeBuiltins([], { laws: "not-evaluated" }),
      cfg({ optionalLayers: ["laws"] }),
    );
    expect(optional.counts).toEqual({
      in_range: 7,
      ran: 7,
      failed: 0,
      not_evaluated: 1,
      required_not_evaluated: 0,
    });
    expect(optional.passed).toBe(true);
    expect(optional.exit_code).toBe(0);
    expect(validateReport(optional).ok).toBe(true);
  });

  it("an optional not-evaluated layer does not stop the run", async () => {
    const calls: string[] = [];
    const layers = fakeBuiltins(calls, { hygiene: "not-evaluated" });
    await run(layers, cfg({ optionalLayers: ["hygiene"] }));
    expect(calls).toHaveLength(7);
  });

  it("the adapter lists the built-in layers the class profile does not require", () => {
    const adapt = (yaml: string): GateConfig => {
      const parsed = parseConfig(`protocol: "0.3.0"\nversion: "0.1.0"\npackage: pkg\n${yaml}`);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
      return toGateConfig(parsed.value, { dependsOnAstro: false });
    };
    expect(adapt("class: ts-library\n").optionalLayers).toEqual([]);
    expect(adapt("class: node-service\n").optionalLayers).toEqual(["build-output"]);
  });
});

describe("G2c metrics", () => {
  it("is an empty object on every layer that has none", async () => {
    const report = await run(fakeBuiltins([]));
    for (const layer of report.layers) {
      expect(layer.metrics).toEqual({});
    }
  });

  it("passes on what a layer reports", async () => {
    const metrics = { coverage: [{ file: "src/a.ts", lines_found: 4, lines_hit: 3 }] };
    const layers = fakeBuiltins([]).map((layer) =>
      layer.id === "coverage"
        ? {
            ...layer,
            run: () =>
              Promise.resolve({ verdict: "pass" as const, findings: [], artifacts: {}, metrics }),
          }
        : layer,
    );
    const report = await run(layers);
    expect(entryOf(report, "coverage").metrics).toEqual(metrics);
    expect(validateReport(report).ok).toBe(true);
  });
});
