import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { ExecResult, LayerContext } from "../../gate/types.ts";
import { astroCheck } from "./build.ts";
import { hygieneLayer } from "./index.ts";
import type { StepContext } from "./tooling.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function stepAnswering(result: ExecResult): {
  step: StepContext;
  dir: string;
  calls: unknown[];
} {
  const dir = mkdtempSync(join(tmpdir(), "wt-astro-step-"));
  roots.push(dir);
  const ctx: LayerContext = {
    cwd: dir,
    config: cfg(),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: () => Promise.resolve(result),
    outDir: dir,
    artifacts: new Map(),
  };
  const calls: unknown[] = [];
  const step: StepContext = {
    ctx,
    settings: cfg().hygiene,
    run: (tool, args) => {
      calls.push([tool, args]);
      return Promise.resolve(result);
    },
    dir,
    out: (name) => join(dir, name),
    pkg: { name: "site", version: "1.0.0", exportsText: "" },
  };
  return { step, dir, calls };
}

const kept = (path: string | undefined): unknown => JSON.parse(readFileSync(String(path), "utf8"));

describe("astro check keeps its result for the laws layer", () => {
  it.each([
    [0, 0],
    [1, 1],
  ])("records exit %i, and reports a finding only when it is not 0", async (code, findings) => {
    const { step, dir, calls } = stepAnswering({ code, stdout: "1 error", stderr: "" });
    const result = await astroCheck(step);
    expect(calls).toEqual([["astro", ["check"]]]);
    expect(result.findings).toHaveLength(findings);
    expect(result.artifacts).toEqual({ "astro-check-json": join(dir, "astro-check.json") });
    expect(kept(result.artifacts?.["astro-check-json"])).toEqual({ command: "astro check", code });
    expect(hygieneLayer.produces).toContain("astro-check-json");
  });

  it("names what astro check said", async () => {
    const { step } = stepAnswering({ code: 1, stdout: "src/a.astro:3 error", stderr: "" });
    const [finding] = (await astroCheck(step)).findings;
    expect(finding).toMatchObject({ tool: "astro", rule: "astro-check", verdict: "fail" });
    expect(finding?.message).toMatch(/^astro check exited 1: /u);
    expect(finding?.message).toContain("src/a.astro:3 error");
  });

  it("keeps nothing when astro cannot be started", async () => {
    const result: ExecResult = { code: null, stdout: "", stderr: "", failure: "tool-missing" };
    const outcome = await astroCheck(stepAnswering(result).step);
    expect(outcome.artifacts).toBeUndefined();
    expect(outcome.findings).toHaveLength(1);
  });
});
