import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { containing } from "./test-support.ts";
import { PROFILES, type Project } from "./profiles.ts";
import { PROTOCOL } from "./protocol.ts";
import { runSemanticChecks } from "./semantic.ts";
import type { WebTopsConfig } from "./types.ts";

const hard: WebTopsConfig = {
  protocol: PROTOCOL,
  version: "0.1.0",
  package: "pkg",
  class: "ts-library",
  enforce: "hard",
  baseline: ".web-tops/baseline.json",
  report: { path: ".web-tops/report.json" },
};

const made: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-semantic-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
}

function pointers(
  config: WebTopsConfig,
  today = "2026-11-16",
  cwd = scratch(),
  project?: Project,
): string[] {
  const context = { cwd, today, ...(project === undefined ? {} : { project }) };
  return runSemanticChecks(config, context).map((problem) => problem.pointer);
}

describe("class has a profile", () => {
  it.each(["cli", "workspace-root", "config-only"] as const)("%s has none", (name) => {
    expect(pointers({ ...hard, class: name })).toEqual(["/class"]);
  });

  it.each(PROFILES.map((profile) => profile.class))("%s has one", (name) => {
    expect(pointers({ ...hard, class: name })).toEqual([]);
  });
});

describe("ts-library keeps unexplained_survivors_max = 0", () => {
  const withMax = (max: number, enabled?: false): WebTopsConfig => ({
    ...hard,
    gates: {
      mutation:
        enabled === undefined
          ? { unexplained_survivors_max: max }
          : { unexplained_survivors_max: max, enabled, reason: "M2" },
    },
  });

  it("refuses a value above 0 while mutation is on", () => {
    expect(pointers(withMax(1))).toEqual(["/gates/mutation/unexplained_survivors_max"]);
  });

  it.each([
    [0, undefined],
    [1, false],
  ] as const)("allows %i when mutation is %s", (max, enabled) => {
    expect(pointers(withMax(max, enabled))).toEqual([]);
  });

  it("leaves the other classes their own values", () => {
    expect(
      pointers({
        ...hard,
        class: "ui-components",
        gates: { mutation: { unexplained_survivors_max: 1 } },
      }),
    ).toEqual([]);
  });
});

describe("advisory needs an exemption whose until holds through that UTC day", () => {
  const advisory = (until?: string): WebTopsConfig => ({
    ...hard,
    enforce: "advisory",
    ...(until === undefined ? {} : { exemption: { until, reason: "migrating" } }),
  });

  it("refuses a missing exemption", () => {
    expect(pointers(advisory())).toEqual(["/exemption"]);
  });

  it.each([
    ["2026-11-17", []],
    ["2026-11-16", []],
    ["2026-11-15", ["/exemption/until"]],
    ["2026-02-30", ["/exemption/until"]],
    ["2026-13-01", ["/exemption/until"]],
  ])("until %s gives %j on 2026-11-16", (until, expected) => {
    expect(pointers(advisory(until))).toEqual(expected);
  });

  it("takes today from the UTC clock when none is given", () => {
    const result = runSemanticChecks(advisory("2000-01-01"), { cwd: scratch() });
    expect(result.map((problem) => problem.pointer)).toEqual(["/exemption/until"]);
    expect(runSemanticChecks(advisory("2999-01-01"), { cwd: scratch() })).toEqual([]);
  });

  it("does not ask hard or ratchet for one", () => {
    expect(pointers(hard)).toEqual([]);
  });
});

describe("under hard, a mapped gate or step cannot be switched off", () => {
  const off = { enabled: false, reason: "later" } as const;
  const ts = (patch: Partial<WebTopsConfig>): WebTopsConfig => ({ ...hard, ...patch });

  it.each([
    [{ gates: { hygiene: off } }, "/gates/hygiene/enabled"],
    [{ gates: { tests: off } }, "/gates/tests/enabled"],
    [{ gates: { coverage: off } }, "/gates/coverage/enabled"],
    [{ gates: { hygiene: { install: off } } }, "/gates/hygiene/install/enabled"],
    [{ gates: { hygiene: { tsc: off } } }, "/gates/hygiene/tsc/enabled"],
    [{ gates: { hygiene: { eslint: off } } }, "/gates/hygiene/eslint/enabled"],
    [{ gates: { hygiene: { format: off } } }, "/gates/hygiene/format/enabled"],
    [
      { gates: { hygiene: { dependency_cruiser: off } } },
      "/gates/hygiene/dependency_cruiser/enabled",
    ],
    [{ gates: { hygiene: { audit: off } } }, "/gates/hygiene/audit/enabled"],
    [{ layers: { package_exports: off } }, "/layers/package_exports/enabled"],
  ] satisfies [Partial<WebTopsConfig>, string][])("%j is refused at %s", (patch, pointer) => {
    expect(pointers(ts(patch))).toEqual([pointer]);
  });

  it.each([
    { gates: { crap: off } },
    { gates: { mutation: off } },
    { layers: { size_limit: off, html_validate: off, axe: off, rendered: off, themes: off } },
    { laws: off },
    { gates: { hygiene: { astro_check: off, stylelint: off } } },
    { layers: { package_exports: { ...off, tier: 2 } } },
  ] satisfies Partial<WebTopsConfig>[])("%j is allowed", (patch) => {
    expect(pointers(ts(patch))).toEqual([]);
  });

  it("refuses a step on the classes that map it, and allows it elsewhere", () => {
    const stylelint = { gates: { hygiene: { stylelint: off } } } as const;
    expect(pointers({ ...hard, class: "astro-site", ...stylelint })).toEqual([
      "/gates/hygiene/stylelint/enabled",
    ]);
    expect(pointers({ ...hard, class: "ui-components", ...stylelint })).toEqual([
      "/gates/hygiene/stylelint/enabled",
    ]);
    expect(pointers({ ...hard, class: "node-service", ...stylelint })).toEqual([]);
  });

  it("astro_check follows the project: always for astro-site, with an astro dependency for web-app and ui-components", () => {
    const astro = { gates: { hygiene: { astro_check: off } } } as const;
    const pointer = ["/gates/hygiene/astro_check/enabled"];
    const withAstro = { dependsOnAstro: true };
    const without = { dependsOnAstro: false };
    for (const project of [withAstro, without]) {
      expect(
        pointers({ ...hard, class: "astro-site", ...astro }, undefined, undefined, project),
      ).toEqual(pointer);
      expect(
        pointers({ ...hard, class: "ts-library", ...astro }, undefined, undefined, project),
      ).toEqual([]);
      expect(
        pointers({ ...hard, class: "node-service", ...astro }, undefined, undefined, project),
      ).toEqual([]);
    }
    for (const name of ["web-app", "ui-components"] as const) {
      expect(pointers({ ...hard, class: name, ...astro }, undefined, undefined, withAstro)).toEqual(
        pointer,
      );
      expect(pointers({ ...hard, class: name, ...astro }, undefined, undefined, without)).toEqual(
        [],
      );
    }
  });

  it("reads the project from the package.json beside the config when none is given", () => {
    const astro = { gates: { hygiene: { astro_check: off } } } as const;
    const config: WebTopsConfig = { ...hard, class: "web-app", ...astro };
    const dir = scratch();
    expect(pointers(config, undefined, dir)).toEqual([]);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { astro: "7.4.0" } }),
    );
    expect(pointers(config, undefined, dir)).toEqual(["/gates/hygiene/astro_check/enabled"]);
  });

  it("allows package_exports off where the class does not map it", () => {
    const patch = { layers: { package_exports: off } } as const;
    expect(pointers({ ...hard, class: "astro-site", ...patch })).toEqual([]);
  });

  it("reports every switched-off item", () => {
    const config = ts({ gates: { tests: off, hygiene: { eslint: off, tsc: off } } });
    expect(pointers(config)).toEqual([
      "/gates/tests/enabled",
      "/gates/hygiene/tsc/enabled",
      "/gates/hygiene/eslint/enabled",
    ]);
  });

  it("asks nothing of ratchet or advisory", () => {
    const patch = {
      gates: { tests: off, hygiene: { eslint: off } },
      layers: { package_exports: off },
    };
    const advisory = {
      enforce: "advisory",
      exemption: { until: "2099-12-31", reason: "x" },
    } as const;
    expect(pointers({ ...hard, ...patch, ...advisory })).toEqual([]);
    // ratchet has no baseline in this directory: the state before the first one, which is not a problem
    expect(pointers({ ...hard, ...patch, enforce: "ratchet" })).toEqual([]);
  });
});

describe("custom layer ids are unique and not built in", () => {
  const custom = (...ids: string[]): WebTopsConfig => ({
    ...hard,
    layers: { custom: ids.map((id) => ({ id, tier: 1, command: "true" })) },
  });

  it("allows distinct ids", () => {
    expect(pointers(custom("a", "b"))).toEqual([]);
  });

  it.each([
    [["hygiene"], ["/layers/custom/0/id"]],
    [
      ["laws", "x", "x"],
      ["/layers/custom/0/id", "/layers/custom/2/id"],
    ],
  ])("%j is refused at %j", (ids, expected) => {
    expect(pointers(custom(...ids))).toEqual(expected);
  });
});

describe("under ratchet the baseline, when there is one, is tracked and clean", () => {
  const ratchet: WebTopsConfig = { ...hard, enforce: "ratchet" };
  const file = ".web-tops/baseline.json";

  function repo(): string {
    const dir = scratch();
    git(dir, "init", "-q");
    mkdirSync(join(dir, ".web-tops"));
    return dir;
  }

  it("allows a missing baseline: the state before the first one, which check names and the history check watches", () => {
    expect(runSemanticChecks(ratchet, { cwd: repo() })).toEqual([]);
  });

  it("refuses an untracked baseline", () => {
    const dir = repo();
    writeFileSync(join(dir, file), "{}\n");
    expect(runSemanticChecks(ratchet, { cwd: dir })).toEqual([
      { pointer: "/baseline", message: containing("not tracked") },
    ]);
  });

  it("refuses a staged baseline that is not committed", () => {
    const dir = repo();
    writeFileSync(join(dir, file), "{}\n");
    git(dir, "add", file);
    expect(runSemanticChecks(ratchet, { cwd: dir })).toEqual([
      { pointer: "/baseline", message: containing("uncommitted") },
    ]);
  });

  it("accepts a committed, unchanged baseline", () => {
    const dir = repo();
    writeFileSync(join(dir, file), "{}\n");
    git(dir, "add", file);
    git(dir, "commit", "-q", "-m", "baseline");
    expect(runSemanticChecks(ratchet, { cwd: dir })).toEqual([]);
  });

  it("refuses a committed baseline that was then changed", () => {
    const dir = repo();
    writeFileSync(join(dir, file), "{}\n");
    git(dir, "add", file);
    git(dir, "commit", "-q", "-m", "baseline");
    writeFileSync(join(dir, file), '{"changed":true}\n');
    expect(runSemanticChecks(ratchet, { cwd: dir })).toEqual([
      { pointer: "/baseline", message: containing("uncommitted") },
    ]);
  });

  it("refuses a baseline outside a git repository", () => {
    const dir = scratch();
    mkdirSync(join(dir, ".web-tops"));
    writeFileSync(join(dir, file), "{}\n");
    expect(pointers(ratchet, "2026-11-16", dir)).toEqual(["/baseline"]);
  });

  it("honours a custom baseline path", () => {
    const dir = repo();
    writeFileSync(join(dir, "b.json"), "{}\n");
    git(dir, "add", "b.json");
    git(dir, "commit", "-q", "-m", "baseline");
    expect(runSemanticChecks({ ...ratchet, baseline: "b.json" }, { cwd: dir })).toEqual([]);
  });

  it("does not look at the baseline under hard", () => {
    expect(pointers(hard)).toEqual([]);
  });
});
