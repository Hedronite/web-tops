import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/validate.ts";
import { toGateConfig } from "./adapter.ts";
import type { GateConfig } from "./types.ts";

function adapt(yaml: string, dependsOnAstro = false): GateConfig {
  const parsed = parseConfig(yaml);
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.problems));
  }
  return toGateConfig(parsed.value, { dependsOnAstro });
}

const HEAD = 'protocol: "0.3.0"\nversion: "0.1.0"\npackage: pkg\n';

describe("toGateConfig: the validated web-tops.yaml as the runner sees it", () => {
  it("carries the class, enforce mode, report path and mutation base", () => {
    const config = adapt(
      `${HEAD}class: ts-library\nenforce: hard\ngates:\n  mutation: { base: develop }\nreport: { path: out/r.json }\n`,
    );
    expect(config).toMatchObject({
      protocol: "0.3.0",
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

  it("derives the gate 1 steps from the class profile and the config switches", () => {
    const config = adapt(
      `${HEAD}class: ui-components\ngates:\n  hygiene:\n    audit: { enabled: false, reason: "offline lab", fail_on: critical }\n    eslint: { config: lint.config.js }\n    format: { tool: biome }\n`,
    );
    expect(config.hygiene).toEqual({
      steps: {
        astro_check: {
          enabled: false,
          reason: "class ui-components maps astro_check only when package.json lists astro",
        },
        audit: { enabled: false, reason: "offline lab" },
      },
      eslintConfig: "lint.config.js",
      formatTool: "biome",
      auditFailOn: "critical",
    });
  });

  it("maps package_exports from the layers table, and defaults the audit level to high", () => {
    const library = adapt(`${HEAD}class: ts-library\n`).hygiene;
    expect(Object.keys(library.steps).toSorted()).toEqual(["astro_check", "stylelint"]);
    expect(library.auditFailOn).toBe("high");
    const service = adapt(`${HEAD}class: node-service\n`).hygiene;
    expect(service.steps.package_exports).toEqual({
      enabled: false,
      reason: "class node-service does not map package_exports",
    });
    const off = adapt(
      `${HEAD}class: ts-library\nlayers:\n  package_exports: { enabled: false, reason: "private package" }\n`,
    ).hygiene;
    expect(off.steps.package_exports).toEqual({ enabled: false, reason: "private package" });
  });

  it.each([
    ["astro-site", false, false],
    ["astro-site", true, false],
    ["web-app", false, true],
    ["web-app", true, false],
    ["ui-components", false, true],
    ["ui-components", true, false],
  ] as const)(
    "%s with astro in package.json %s: astro_check is switched off %s",
    (className, dependsOnAstro, switchedOff) => {
      const config = adapt(`${HEAD}class: ${className}\n`, dependsOnAstro);
      expect(config.hygiene.steps.astro_check).toEqual(
        switchedOff
          ? {
              enabled: false,
              reason: `class ${className} maps astro_check only when package.json lists astro`,
            }
          : undefined,
      );
    },
  );

  it("never maps astro_check for a class outside the Astro table, whatever package.json lists", () => {
    expect(adapt(`${HEAD}class: node-service\n`, true).hygiene.steps.astro_check).toEqual({
      enabled: false,
      reason: "class node-service does not map astro_check",
    });
    expect(adapt(`${HEAD}class: ts-library\n`, true).hygiene.steps.astro_check).toEqual({
      enabled: false,
      reason: "class ts-library does not map astro_check",
    });
  });

  it("takes the coverage floor from the config, else from the class profile", () => {
    expect(adapt(`${HEAD}class: ts-library\n`).coverage).toEqual({ linesFloor: 85, exclude: [] });
    expect(adapt(`${HEAD}class: astro-site\n`).coverage.linesFloor).toBe(70);
    expect(adapt(`${HEAD}class: node-service\n`).coverage.linesFloor).toBe(80);
    const config = adapt(
      `${HEAD}class: ts-library\ngates:\n  coverage:\n    lines_floor: 90\n    exclude:\n      - { glob: "src/generated/**", reason: "written by the schema compiler" }\n`,
    );
    expect(config.coverage).toEqual({
      linesFloor: 90,
      exclude: [{ glob: "src/generated/**", reason: "written by the schema compiler" }],
    });
  });

  it("shuffles the tests unless gates.tests.shuffle says otherwise", () => {
    expect(adapt(`${HEAD}class: ts-library\n`).tests).toEqual({ shuffle: true });
    expect(adapt(`${HEAD}class: ts-library\ngates:\n  tests: { shuffle: false }\n`).tests).toEqual({
      shuffle: false,
    });
  });

  it("passes configured budgets and routes through and omits them when empty or unset", () => {
    const plain = adapt(`${HEAD}class: astro-site\n`);
    expect(plain.routes).toBeUndefined();
    expect(plain.budgets).toBeUndefined();
    expect(adapt(`${HEAD}class: astro-site\nbudgets: {}\n`).budgets).toBeUndefined();

    const rich = adapt(
      `${HEAD}class: web-app\nroutes:\n  - /\n  - /docs/\nbudgets:\n  page_js_bytes: 51200\n  static_page_js_bytes: 0\n  route_js_bytes: 174080\n  pages:\n    /big/: 90000\n  routes:\n    /docs/: 120000\n`,
    );
    expect(rich.routes).toEqual(["/", "/docs/"]);
    expect(rich.budgets).toEqual({
      pageJsBytes: 51200,
      staticPageJsBytes: 0,
      routeJsBytes: 174080,
      pages: { "/big/": 90000 },
      routes: { "/docs/": 120000 },
    });
  });

  it("passes size_limit and budgets.entries through with layer precedence and omits when unset", () => {
    expect(adapt(`${HEAD}class: ts-library\n`).sizeLimit).toBeUndefined();
    expect(
      adapt(`${HEAD}class: ts-library\nlayers:\n  size_limit: { tier: 1 }\n`).sizeLimit,
    ).toBeUndefined();

    const parsed = parseConfig(
      `${HEAD}class: ts-library\nbudgets:\n  entries:\n    ".": 1000\n    "./a": 2000\nlayers:\n  size_limit:\n    skip_private: internal\n    default_bytes: 4096\n    entries:\n      ".": 512\n`,
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    const adapted = toGateConfig(parsed.value, { dependsOnAstro: false, isPrivate: true });
    expect(adapted.sizeLimit).toEqual({
      skipPrivate: "internal",
      defaultBytes: 4096,
      entries: { ".": 512, "./a": 2000 },
    });

    expect(
      adapt(`${HEAD}class: ts-library\nbudgets:\n  entries:\n    ".": 777\n`).sizeLimit,
    ).toEqual({
      entries: { ".": 777 },
    });
  });
});
