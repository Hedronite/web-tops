import { describe, expect, it } from "vitest";
import { BUILTIN_IDS, type GateConfig } from "./types.ts";
import { cfg, noExec, off, opts, tickingClock } from "./testkit.ts";
import { buildRegistry } from "./registry.ts";
import { runGate } from "./runner.ts";

function runReal(config: GateConfig) {
  return runGate({
    layers: buildRegistry(config),
    config,
    options: opts({ keepGoing: true }),
    cwd: "/unused",
    env: {},
    exec: noExec,
    outDir: "/unused/.web-tops/out",
    now: tickingClock(),
  });
}

const LATER = [
  ["crap", "M2"],
  ["mutation", "M2"],
  ["build-output", "M4"],
  ["laws", "M3"],
] as const;

describe("G2e stubs: crap, mutation, build-output and laws report not-run when enabled", () => {
  it("registers the seven built-in layers in gate order", () => {
    expect(buildRegistry(cfg()).map((layer) => layer.id)).toEqual([...BUILTIN_IDS]);
  });

  it.each(LATER)(
    "enabling %s yields not-run naming %s, and a failed gate",
    async (id, milestone) => {
      const only: Record<string, { enabled: boolean; reason?: string }> = {};
      for (const [other] of LATER) {
        only[other] = other === id ? { enabled: true } : off(`later milestone ${other}`);
      }
      const report = await runReal(
        cfg({ toggles: { ...only, hygiene: off("t"), tests: off("t"), coverage: off("t") } }),
      );
      const layer = report.layers.find((entry) => entry.id === id);
      expect(layer?.verdict).toBe("not-run");
      expect(layer?.reason).toContain(milestone);
      expect(report.exit_code).toBe(1);
      expect(report.layers.filter((entry) => entry.verdict === "not-run")).toHaveLength(1);
    },
  );

  it.each(LATER)(
    "%s disabled in config is skip with the config reason, not a silent skip",
    async (id) => {
      const toggles: Record<string, { enabled: boolean; reason?: string }> = {};
      for (const [other] of LATER) {
        toggles[other] = off(`${other} lands later`);
      }
      const report = await runReal(
        cfg({ toggles: { ...toggles, hygiene: off("t"), tests: off("t"), coverage: off("t") } }),
      );
      expect(report.layers.find((entry) => entry.id === id)).toMatchObject({
        verdict: "skip",
        reason: `${id} lands later`,
      });
    },
  );

  it("puts every built-in id in the report even when the config says nothing about it", async () => {
    const report = await runReal(cfg());
    expect(report.layers.map((layer) => layer.id)).toEqual([...BUILTIN_IDS]);
  });

  it("a custom layer with a command is not-run too: custom layers run from M4", async () => {
    const config = cfg({ custom: [{ id: "budgets", tier: 1, command: "bun run budgets" }] });
    const report = await runReal(config);
    expect(report.layers.find((layer) => layer.id === "budgets")).toMatchObject({
      verdict: "not-run",
      reason: "custom layers run from M4",
    });
  });
});
