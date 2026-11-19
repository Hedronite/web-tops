import { describe, expect, it } from "vitest";
import type { WebTopsConfig } from "../config/types.ts";
import { parseConfig } from "../config/validate.ts";
import { toGateConfig } from "./adapter.ts";

const HEAD = 'protocol: "0.3.0"\nversion: "0.1.0"\npackage: pkg\n';

function config(body: string): WebTopsConfig {
  const parsed = parseConfig(`${HEAD}${body}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return parsed.value;
}

const GENERIC = "disabled in web-tops.yaml";

describe("toGateConfig: a switch turned off with no reason", () => {
  it("gets the generic reason", () => {
    const base = config("class: ts-library\nenforce: ratchet\n");
    const gate = toGateConfig(
      { ...base, gates: { crap: { enabled: false } } },
      {
        dependsOnAstro: false,
      },
    );
    expect(gate.toggles["crap"]).toEqual({ enabled: false, reason: GENERIC });
  });

  it("gets the generic reason for build output when every mapped layer is off and none says why", () => {
    const base = config("class: astro-site\nenforce: ratchet\n");
    const off = { enabled: false };
    const layers = { size_limit: off, html_validate: off, axe: off, rendered: off, themes: off };
    const gate = toGateConfig({ ...base, layers }, { dependsOnAstro: true });
    expect(gate.toggles["build-output"]).toEqual({ enabled: false, reason: GENERIC });
  });

  it("takes the first reason the config gives, not the first layer's silence", () => {
    const base = config("class: astro-site\nenforce: ratchet\n");
    const silent = { enabled: false };
    const said = { enabled: false, reason: "no build in this repository" };
    const layers = {
      html_validate: silent,
      size_limit: said,
      axe: said,
      rendered: said,
      themes: said,
    };
    const gate = toGateConfig({ ...base, layers }, { dependsOnAstro: true });
    expect(gate.toggles["build-output"]).toEqual({
      enabled: false,
      reason: "no build in this repository",
    });
  });

  it("keeps build output on when one mapped layer is not switched off", () => {
    const base = config("class: astro-site\nenforce: ratchet\n");
    const off = { enabled: false, reason: "r" };
    const layers = { size_limit: off, html_validate: off, axe: off, rendered: off };
    const gate = toGateConfig({ ...base, layers }, { dependsOnAstro: true });
    expect(gate.toggles["build-output"]).toBeUndefined();
  });
});

describe("toGateConfig: why a gate 1 step is not mapped", () => {
  const steps = (className: string, dependsOnAstro: boolean) =>
    toGateConfig(config(`class: ${className}\nenforce: ratchet\n`), { dependsOnAstro }).hygiene
      .steps;

  it("says a conditional step waits for astro in package.json, and another step is simply not mapped", () => {
    expect(steps("web-app", false)).toEqual({
      astro_check: {
        enabled: false,
        reason: "class web-app maps astro_check only when package.json lists astro",
      },
      package_exports: { enabled: false, reason: "class web-app does not map package_exports" },
    });
  });

  it("says a step no project can map is not mapped", () => {
    expect(steps("node-service", true)["astro_check"]).toEqual({
      enabled: false,
      reason: "class node-service does not map astro_check",
    });
  });

  it("maps a conditional step once the project lists astro", () => {
    expect(steps("web-app", true)["astro_check"]).toBeUndefined();
  });
});

describe("toGateConfig: a class with no launch profile", () => {
  it("is refused by name", () => {
    const base = config("class: ts-library\nenforce: ratchet\n");
    expect(() =>
      toGateConfig(Object.assign({}, base, { class: "nonesuch" }), { dependsOnAstro: false }),
    ).toThrow("class nonesuch has no launch profile");
  });
});
