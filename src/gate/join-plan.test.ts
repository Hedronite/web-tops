import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareOutDir } from "./command.ts";
import { planGate } from "./plan.ts";
import { contextOf, inputProblem } from "./runner.ts";
import type { Exec, GateConfig, GateOptions, Layer } from "./types.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const noExec: Exec = () => Promise.resolve({ code: 0, stdout: "", stderr: "" });

const BASE_CONFIG: GateConfig = {
  protocol: "0.3.0",
  package: "pkg",
  class: "ts-library",
  enforce: "hard",
  reportPath: ".web-tops/report.json",
  toggles: {},
  custom: [],
  optionalLayers: [],
  hygiene: { steps: {}, auditFailOn: "high" },
  tests: { shuffle: false },
  coverage: { linesFloor: 85, exclude: [] },
  crap: { cap: 4, scope: "diff", nullishDiscount: true },
  mutation: { scope: "diff", maxSurvivors: 0, timeBudgetMinutes: 30 },
};

const BASE_OPTS: GateOptions = {
  maxTier: 1,
  keepGoing: false,
  json: false,
  dryRun: false,
  all: false,
};

function stubLayer(id: string, gate: Layer["gate"], consumes: Layer["consumes"] = []): Layer {
  return {
    id,
    gate,
    tier: 1,
    classes: ["ts-library"],
    requires: [],
    produces: [],
    consumes,
    run: () => Promise.resolve({ verdict: "pass", findings: [], artifacts: {} }),
  };
}

describe("planGate, runner, and outDir wiring for --join", () => {
  it("skips non-mutation layers with ran in shard jobs and keeps mutation in range", () => {
    const layers = [stubLayer("tests", 2), stubLayer("mutation", 5), stubLayer("laws", "laws")];
    const plan = planGate(layers, BASE_CONFIG, { ...BASE_OPTS, join: "shards" });
    expect(plan.find((item) => item.id === "tests")?.skip).toBe("ran in shard jobs");
    expect(plan.find((item) => item.id === "laws")?.skip).toBe("ran in shard jobs");
    expect(plan.find((item) => item.id === "mutation")?.skip).toBeUndefined();
  });

  it("passes joinDir in contextOf and waives vitest-config input only for mutation under --join", () => {
    const baseInput = {
      layers: [],
      config: BASE_CONFIG,
      options: BASE_OPTS,
      cwd: "/tmp/wt-unused",
      env: {},
      exec: noExec,
      outDir: "/tmp/wt-unused/.web-tops/out",
      now: () => 1_700_000_000_000,
    };
    const plain = contextOf(baseInput, "origin/main", new Map());
    expect("joinDir" in plain).toBe(false);
    const joined = contextOf(
      { ...baseInput, options: { ...BASE_OPTS, join: "shards" } },
      "origin/main",
      new Map(),
    );
    expect(joined.joinDir).toBe("shards");

    const mut = stubLayer("mutation", 5, [{ artifact: "vitest-config", from: "tests" }]);
    const crap = stubLayer("crap", 4, [{ artifact: "coverage-json", from: "tests" }]);
    const emptyState = {
      layers: [],
      produced: new Map(),
      inRange: 0,
      ran: 0,
      stoppedAt: undefined,
    };
    expect(inputProblem(mut, emptyState, "shards")).toBeUndefined();
    expect(inputProblem(mut, emptyState, undefined)).toContain("vitest-config");
    expect(inputProblem(crap, emptyState, "shards")).toContain("coverage-json");
  });

  it("preserves .web-tops/out when --join is set and wipes it otherwise", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-join-outdir-"));
    dirs.push(dir);
    const keepFile = join(dir, ".web-tops", "out", "shards", "s1.json");
    mkdirSync(join(dir, ".web-tops", "out", "shards"), { recursive: true });
    writeFileSync(keepFile, "{}");
    prepareOutDir(dir, join(dir, ".web-tops", "out", "shards"));
    expect(existsSync(keepFile)).toBe(true);
    prepareOutDir(dir, undefined);
    expect(existsSync(keepFile)).toBe(false);
  });
});
