import { describe, expect, it } from "vitest";
import { buildRegistry } from "./registry.ts";
import { compareGates } from "./order.ts";
import { customLayer } from "./stubs.ts";
import { cfg, noExec } from "./testkit.ts";
import type { LayerContext } from "./types.ts";

describe("the registry lists the layers in gate order", () => {
  it("with the config's custom layers between gate 6 and laws", () => {
    const config = cfg({
      custom: [
        { id: "extra", tier: 1, command: "echo" },
        { id: "more", tier: 2 },
      ],
    });
    const layers = buildRegistry(config);
    expect(layers.map((layer) => layer.id)).toEqual([
      "hygiene",
      "tests",
      "coverage",
      "crap",
      "mutation",
      "build-output",
      "extra",
      "more",
      "laws",
    ]);
    const gates = layers.map((layer) => layer.gate);
    expect(gates).toEqual([...gates].sort(compareGates));
  });
});

describe("a custom layer is a gate 6 layer that is not run yet", () => {
  it("needs and gives nothing, for every launch class, and is not-run with the reason it has no command", async () => {
    const mapped = customLayer("extra", 2, "echo");
    expect(mapped).toMatchObject({
      id: "extra",
      gate: 6,
      tier: 2,
      requires: [],
      produces: [],
      consumes: [],
    });
    expect(mapped.classes).toEqual([
      "ts-library",
      "ui-components",
      "astro-site",
      "web-app",
      "node-service",
    ]);
    const ctx: LayerContext = {
      cwd: ".",
      config: cfg(),
      base: "origin/main",
      enforce: "hard",
      env: {},
      exec: noExec,
      outDir: ".",
      artifacts: new Map(),
    };
    const results = [await mapped.run(ctx), await customLayer("bare", 1, undefined).run(ctx)];
    expect(results.map((result) => result.verdict)).toEqual(["not-run", "not-run"]);
    expect(results.map((result) => result.reason)).toEqual([
      "custom layers are not run yet",
      "no command is mapped to this layer",
    ]);
    expect(results.map((result) => result.findings)).toEqual([[], []]);
  });
});
