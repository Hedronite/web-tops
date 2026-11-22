import { describe, expect, it } from "vitest";
import { cfg, noExec, opts } from "./testkit.ts";
import { contextOf } from "./runner.ts";

/** The day the runner hands every layer comes from the runner's clock (WEB_TOPS.md section 8.1). */

const input = (now: number) => ({
  layers: [],
  config: cfg(),
  options: opts(),
  cwd: "/project",
  env: {},
  exec: noExec,
  outDir: "/project/.web-tops/out",
  now: () => now,
});

describe("contextOf", () => {
  it("carries the UTC day of the runner's clock, not the machine's", () => {
    const late = contextOf(input(Date.UTC(2026, 10, 20, 23, 59, 59)), "origin/main", new Map());
    const early = contextOf(input(Date.UTC(2026, 10, 21, 0, 0, 0)), "origin/main", new Map());
    expect([late.today, early.today]).toEqual(["2026-11-20", "2026-11-21"]);
  });

  it("is the run's settings: the project, the base and the artifacts", () => {
    const given = new Map([["lcov", "/project/lcov.info"]]);
    const made = contextOf(input(Date.UTC(2026, 10, 20)), "origin/dev", given);
    expect([made.cwd, made.base, made.enforce, made.outDir]).toEqual([
      "/project",
      "origin/dev",
      "hard",
      "/project/.web-tops/out",
    ]);
    expect(made.artifacts).toBe(given);
  });
});
