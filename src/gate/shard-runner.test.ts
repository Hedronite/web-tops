import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contextOf, mutationLedger } from "./runner.ts";
import type { Exec, GateConfig, GateOptions } from "./types.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const noExec: Exec = () => Promise.resolve({ code: 0, stdout: "", stderr: "" });

const baseConfig: GateConfig = {
  protocol: "0.3.0",
  package: "fixture",
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

const baseOpts: GateOptions = {
  maxTier: 1,
  keepGoing: false,
  json: false,
  dryRun: false,
  all: false,
};

describe("runner shard wiring", () => {
  it("passes options.shard to LayerContext and omits it when unset", () => {
    const baseInput = {
      layers: [],
      config: baseConfig,
      options: baseOpts,
      cwd: "/tmp/wt-unused",
      env: {},
      exec: noExec,
      outDir: "/tmp/wt-unused/.web-tops/out",
      now: () => 1_700_000_000_000,
    };
    const unsharded = contextOf(baseInput, "origin/main", new Map());
    expect(unsharded.shard).toBeUndefined();
    expect("shard" in unsharded).toBe(false);
    const sharded = contextOf(
      { ...baseInput, options: { ...baseOpts, shard: { index: 2, count: 4 } } },
      "origin/main",
      new Map(),
    );
    expect(sharded.shard).toEqual({ index: 2, count: 4 });
  });

  it("skips reading the survivor ledger during sharded runs and on non-mutation layers", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-shard-ledger-"));
    dirs.push(dir);
    mkdirSync(join(dir, ".web-tops"), { recursive: true });
    writeFileSync(join(dir, ".web-tops", "survivors.yaml"), "not: valid: ledger: [");
    const input = {
      layers: [],
      config: baseConfig,
      options: baseOpts,
      cwd: dir,
      env: {},
      exec: noExec,
      outDir: join(dir, ".web-tops", "out"),
      now: () => 1_700_000_000_000,
    };
    expect(
      mutationLedger("mutation", {
        ...input,
        options: { ...baseOpts, shard: { index: 1, count: 2 } },
      }),
    ).toBeUndefined();
    expect(mutationLedger("tests", input)).toBeUndefined();
  });
});
