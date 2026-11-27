import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Law } from "../../laws/catalog/index.ts";
import { entryOf } from "./catalog.ts";
import { lawsOfProject, type ClassedLaw } from "./entries.ts";

/** A law a class maps only for a project that depends on Astro (section 5.2: W-27). */

const law = (id: string, extra: Partial<ClassedLaw> = {}): ClassedLaw => ({
  id,
  severity: "R",
  reader: "tl",
  classes: ["ui-components", "astro-site", "web-app"],
  judged: true,
  rules: [],
  ...extra,
});

const CONDITIONAL = law("W-27", { conditional: ["ui-components", "web-app"] });
const PLAIN = law("W-20");

const ids = (className: string, dependsOnAstro: boolean): string[] =>
  lawsOfProject([PLAIN, CONDITIONAL], className, dependsOnAstro).map((found) => found.id);

describe("the laws a class maps in a project", () => {
  it.each(["web-app", "ui-components"])(
    "leaves a conditional law out for a %s without Astro, and maps it with Astro",
    (className) => {
      expect(ids(className, false)).toEqual(["W-20"]);
      expect(ids(className, true)).toEqual(["W-20", "W-27"]);
    },
  );

  it("keeps it for a class that is not a conditional one, whatever the project depends on", () => {
    expect(ids("astro-site", false)).toEqual(["W-20", "W-27"]);
  });

  it("maps nothing to a class the law does not list, Astro or not", () => {
    expect(ids("node-service", true)).toEqual([]);
  });
});

const catalogLaw = (extra: Partial<Law> = {}): Law => ({
  id: "W-27",
  title: "t",
  family: "f",
  severity: "R",
  classes: ["astro-site", "web-app"],
  reader: { kinds: ["tl"], text: "tl" },
  rules: [],
  judged: "v0.1",
  rationale: "r",
  fix: "f",
  ...extra,
});

describe("the entry the layer takes from a catalog law", () => {
  it("keeps its conditional classes, and has none for a law without", () => {
    expect(entryOf(catalogLaw({ conditional_classes: ["web-app"] })).conditional).toEqual([
      "web-app",
    ]);
    expect(entryOf(catalogLaw())).not.toHaveProperty("conditional");
  });
});

/** The layer over the real catalog, in a process of its own: it adds nothing a stand-in does not (R112). */
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

const roots: string[] = [];

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const LAYER = resolve(import.meta.dirname, "index.ts");
const CATALOG = resolve(import.meta.dirname, "catalog.ts");
const TESTKIT = resolve(import.meta.dirname, "../../gate/testkit.ts");

/** Runs the layer on a web-app whose git tracks nothing, and prints what it said of W-27. */
const script = (cwd: string): string => `
const { lawsLayer } = await import(${JSON.stringify(LAYER)});
const { yamlCatalog } = await import(${JSON.stringify(CATALOG)});
const { cfg } = await import(${JSON.stringify(TESTKIT)});
const cwd = ${JSON.stringify(cwd)};
const exec = async (command) => ({
  code: 0,
  stdout: command === "git" ? "" : JSON.stringify({ ignored: {}, levels: {} }),
  stderr: "",
});
const result = await lawsLayer(yamlCatalog).run({
  cwd,
  config: cfg({ class: "web-app" }),
  base: "origin/main",
  enforce: "hard",
  env: {},
  exec,
  outDir: cwd + "/.web-tops/out",
  artifacts: new Map([["eslint-json", cwd + "/empty.json"], ["tsc-diagnostics", cwd + "/empty.json"]]),
});
const found = result.findings.filter((finding) => finding.rule === "law/W-27");
process.stdout.write(JSON.stringify(found.map((finding) => finding.required)));
`;

function w27(manifest: object): unknown {
  const cwd = mkdtempSync(join(tmpdir(), "wt-conditional-"));
  roots.push(cwd);
  mkdirSync(join(cwd, ".web-tops"));
  writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(cwd, "empty.json"), "[]\n");
  const run = spawnSync("bun", ["-e", script(cwd)], {
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout);
}

describe.skipIf(insideStryker)(
  "the laws layer asks the project whether it depends on Astro",
  () => {
    it("gives a web-app without Astro no finding for W-27", { timeout: 60_000 }, () => {
      expect(w27({ name: "app", dependencies: { vite: "1" } })).toEqual([]);
    });

    it.each(["dependencies", "devDependencies", "peerDependencies"])(
      "requires W-27 once astro is in %s",
      { timeout: 60_000 },
      (field) => {
        expect(w27({ name: "app", [field]: { astro: "7" } })).toEqual([true]);
      },
    );
  },
);
