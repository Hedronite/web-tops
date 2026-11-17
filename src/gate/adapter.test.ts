import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import { toGateConfig } from "./adapter.ts";
import type { GateConfig } from "./types.ts";

function adapt(yaml: string): GateConfig {
  const parsed = parseConfig(yaml);
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.problems));
  }
  return toGateConfig(parsed.value);
}

const HEAD = 'protocol: "0.2.1"\nversion: "0.1.0"\npackage: pkg\n';

describe("toGateConfig: the validated web-tops.yaml as the runner sees it", () => {
  it("carries the class, enforce mode, report path and mutation base", () => {
    const config = adapt(
      `${HEAD}class: ts-library\nenforce: hard\ngates:\n  mutation: { base: develop }\nreport: { path: out/r.json }\n`,
    );
    expect(config).toMatchObject({
      protocol: "0.2.1",
      package: "pkg",
      class: "ts-library",
      enforce: "hard",
      base: "develop",
      reportPath: "out/r.json",
    });
  });

  it("switches off exactly what the config switches off, with the config's reason", () => {
    const config = adapt(
      `${HEAD}class: ts-library\nenforce: hard\ngates:\n  crap: { enabled: false, reason: "M2" }\n  mutation: { enabled: false, reason: "M2", unexplained_survivors_max: 0 }\nlayers:\n  size_limit: { enabled: false, reason: "M4" }\nlaws: { enabled: false, reason: "M3" }\n`,
    );
    expect(config.toggles).toEqual({
      crap: { enabled: false, reason: "M2" },
      mutation: { enabled: false, reason: "M2" },
      "build-output": { enabled: false, reason: "M4" },
      laws: { enabled: false, reason: "M3" },
    });
  });

  it("leaves everything enabled when the config says nothing", () => {
    expect(adapt(`${HEAD}class: astro-site\n`).toggles).toEqual({});
  });

  it("keeps build output on while any build-output layer the class maps is on", () => {
    const config = adapt(
      `${HEAD}class: astro-site\nlayers:\n  axe: { enabled: false, reason: "later" }\n  html_validate: { enabled: false, reason: "later" }\n  rendered: { enabled: false, reason: "later" }\n`,
    );
    expect(config.toggles["build-output"]).toBeUndefined();
  });

  it("switches build output off when a class maps none of its layers, naming the class", () => {
    expect(adapt(`${HEAD}class: node-service\n`).toggles["build-output"]).toEqual({
      enabled: false,
      reason: "class node-service maps no build-output layer",
    });
  });

  it("passes custom layers through with their tier and command", () => {
    const config = adapt(
      `${HEAD}class: ts-library\nlayers:\n  custom:\n    - { id: budgets, tier: 2, command: "bun run budgets" }\n`,
    );
    expect(config.custom).toEqual([{ id: "budgets", tier: 2, command: "bun run budgets" }]);
  });
});
