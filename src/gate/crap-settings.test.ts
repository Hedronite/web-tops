import { describe, expect, it } from "vitest";
import { crapLayer } from "../layers/crap/index.ts";
import { parseConfig } from "../config/validate.ts";
import { toGateConfig } from "./adapter.ts";
import { parseGateArgs } from "./options.ts";
import { buildRegistry } from "./registry.ts";
import { runGate } from "./runner.ts";
import { cfg, fakeLayer, noExec, opts, tickingClock } from "./testkit.ts";
import type { GateConfig, LayerContext } from "./types.ts";

/** G4b, G4c: the CRAP layer's settings reach it: the cap and scope from the config, `--all` from the command line. */

function adapt(yaml: string): GateConfig {
  const parsed = parseConfig(`protocol: "0.3.0"\nversion: "0.1.0"\npackage: pkg\n${yaml}`);
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.problems));
  }
  return toGateConfig(parsed.value, { dependsOnAstro: false });
}

describe("G4b the cap, the scope and the nullish rule come from the config, with the class profile's cap by default", () => {
  it.each([
    ["ts-library", 4],
    ["ui-components", 5],
    ["astro-site", 6],
    ["web-app", 6],
    ["node-service", 5],
  ])("class %s has the cap %d of section 5.2", (name, cap) => {
    expect(adapt(`class: ${name}\n`).crap).toEqual({ cap, scope: "diff", nullishDiscount: true });
  });

  it("takes gates.crap.cap, scope and complexity.nullish_discount when the config sets them", () => {
    const config = adapt(
      "class: ts-library\ngates:\n  crap: { cap: 3, scope: all, complexity: { nullish_discount: false } }\n",
    );
    expect(config.crap).toEqual({ cap: 3, scope: "all", nullishDiscount: false });
  });
});

describe("G4b gate --all", () => {
  it("is off by default and on with the flag, beside the other flags", () => {
    expect(parseGateArgs([])).toMatchObject({ ok: true, options: { all: false } });
    expect(parseGateArgs(["--all"])).toMatchObject({ ok: true, options: { all: true } });
    expect(parseGateArgs(["--all", "--keep-going", "--max-tier", "2"])).toMatchObject({
      ok: true,
      options: { all: true, keepGoing: true, maxTier: 2 },
    });
  });

  it("reaches the layers: a layer is told whether the run is --all", async () => {
    let seen: LayerContext | undefined;
    const spy = {
      ...fakeLayer({ id: "hygiene", gate: 1 }),
      run: (ctx: LayerContext) => {
        seen = ctx;
        return Promise.resolve({ verdict: "pass" as const, findings: [], artifacts: {} });
      },
    };
    for (const all of [false, true]) {
      await runGate({
        layers: [spy],
        config: cfg(),
        options: opts({ all }),
        cwd: "/unused",
        env: {},
        exec: noExec,
        outDir: "/unused/.web-tops/out",
        now: tickingClock(),
      });
      expect(seen?.all).toBe(all);
    }
  });
});

describe("G4c the registry holds the CRAP layer, not a stub", () => {
  it("registers crapLayer for gate 4", () => {
    const layer = buildRegistry(cfg()).find((item) => item.id === "crap");
    expect(layer).toBe(crapLayer);
  });
});
