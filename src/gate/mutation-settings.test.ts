import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import { mutationLayer } from "../layers/mutation/index.ts";
import { toGateConfig } from "./adapter.ts";
import { buildRegistry } from "./registry.ts";
import { cfg } from "./testkit.ts";
import type { GateConfig } from "./types.ts";

/** G7b, G7c: the layer's settings reach it, and the registry holds it. */

function adapt(yaml: string): GateConfig {
  const parsed = parseConfig(`protocol: "0.3.0"\nversion: "0.1.0"\npackage: pkg\n${yaml}`);
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.problems));
  }
  return toGateConfig(parsed.value, { dependsOnAstro: false });
}

describe("G7b the survivor maximum, the scope and the time budget", () => {
  it.each([
    ["ts-library", 0],
    ["ui-components", 1],
    ["astro-site", 2],
    ["web-app", 2],
    ["node-service", 1],
  ])(
    "class %s has the unexplained survivors maximum %d of section 5.2, the diff scope and 30 minutes",
    (name, max) => {
      expect(adapt(`class: ${name}\n`).mutation).toEqual({
        scope: "diff",
        maxSurvivors: max,
        timeBudgetMinutes: 30,
      });
    },
  );

  it("takes gates.mutation.unexplained_survivors_max, scope and time_budget_minutes when the config sets them", () => {
    const config = adapt(
      "class: ts-library\ngates:\n  mutation: { scope: all, unexplained_survivors_max: 0, time_budget_minutes: 45 }\n",
    );
    expect(config.mutation).toEqual({ scope: "all", maxSurvivors: 0, timeBudgetMinutes: 45 });
  });

  it.each([0, -1, "ten"])("refuses a time_budget_minutes of %j", (value) => {
    const parsed = parseConfig(
      `protocol: "0.3.0"\nversion: "0.1.0"\npackage: pkg\nclass: ts-library\ngates:\n  mutation: { time_budget_minutes: ${JSON.stringify(value)} }\n`,
    );
    expect(parsed.ok).toBe(false);
  });
});

describe("G7c the registry holds the mutation layer, not a stub", () => {
  it("registers mutationLayer for gate 5", () => {
    expect(buildRegistry(cfg()).find((item) => item.id === "mutation")).toBe(mutationLayer);
  });
});
