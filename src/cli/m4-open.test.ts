import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import knipConfig from "../../knip.json" with { type: "json" };
import vitestConfig from "../../vitest.config.ts";
import { checkConfigFile, loadConfig, parseConfig } from "../config/validate.ts";
import { TOOL_PINS } from "../lock/pins.ts";
import { diagnose, runDoctorCli } from "./doctor.ts";
import type { Io } from "./io.ts";
import { runLockCli } from "./lock.ts";

const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;
const root = resolve(import.meta.dirname, "../..");
const spec = readFileSync(join(root, "WEB_TOPS.md"), "utf8");
const section = (from: string, to: string): string =>
  spec.slice(spec.indexOf(from), spec.indexOf(to));

function get(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const M4_TOOLS = [
  ["html-validate", /^11\.\d+\.\d+$/],
  ["@playwright/test", /^1\.65\.\d+$/],
  ["@axe-core/playwright", /^4\.14\.\d+$/],
  ["size-limit", /^14\.\d+\.\d+$/],
  ["@size-limit/file", /^14\.\d+\.\d+$/],
] as const;

describe("M4 G0a: M4 build-output tools are pinned exactly", () => {
  it.each(M4_TOOLS)("%s is a devDependency at its exact pin (%s)", (name, pattern) => {
    const version = get(TOOL_PINS, name);
    expect(version).toMatch(pattern);
    expect(get(pkg.devDependencies, name)).toBe(version);
  });

  it.each(M4_TOOLS.map(([name]) => name))("web-tops.lock records %s at its pin", (name) => {
    const version = String(get(TOOL_PINS, name));
    const escaped = name.replace(/[/@]/g, (char) => `\\${char}`);
    const line = new RegExp(`^"?${escaped}"?: ${version.replaceAll(".", "\\.")}$`, "m");
    expect(readFileSync(join(root, "web-tops.lock"), "utf8")).toMatch(line);
  });

  it("section 2 names every M4 tool at its full pinned version", () => {
    const pins = section("## 2. Pins", "## 3.");
    const row = pins.split("\n").find((line) => line.startsWith("| Build output |")) ?? "";
    for (const [name] of M4_TOOLS) {
      expect(row).toContain(`\`${name}\` ${String(get(TOOL_PINS, name))}`);
    }
    expect(pins).not.toContain("chosen in M3");
  });

  it("lock --verify and doctor exit 0, and doctor checks Playwright for browser classes", async () => {
    const run = async (cmd: (argv: readonly string[], io: Io) => Promise<number>) => {
      const lines: string[] = [];
      const io: Io = {
        out: (text) => lines.push(text),
        err: (text) => lines.push(text),
        cwd: root,
        env: process.env,
      };
      return { code: await cmd([], io), text: lines.join("") };
    };
    const locked = await run(runLockCli);
    expect(locked.code, locked.text).toBe(0);
    const doc = await run(runDoctorCli);
    expect(doc.code, doc.text).toBe(0);
    const missing = diagnose(
      { bun: "1.4.4", node: "24.22.3", typescript: TOOL_PINS.typescript, chromium: "present" },
      { className: "web-app", typescript: TOOL_PINS.typescript, nodeRange: undefined },
    ).filter((check) => check.status === "missing");
    expect(missing).toEqual([]);
  });
});

describe("M4 G0b: WEB_TOPS.md section 7 and section 17 reflect native dist/ checks and reserved paths", () => {
  it("section 7 replaces [verify tool] with native link, anchor, and local asset checks", () => {
    expect(spec).not.toContain("[verify tool]");
    const sec7 = section("## 7. ", "## 8. ");
    const row = sec7.split("\n").find((line) => line.startsWith("| Internal links |")) ?? "";
    expect(row).toContain("native");
    expect(row).toContain("dist/");
    expect(row).toContain("anchors");
    expect(row).toContain("src");
    expect(row).toContain("href");
  });

  function assertReservedOrLanded(sec17: string, pending: string, path: string): void {
    if (!existsSync(join(root, path))) {
      expect(pending, path).toContain(`\`${path}\``);
      return;
    }
    expect(pending, path).not.toContain(`\`${path}\``);
    const leaf = path.replace(/\/$/u, "").split("/").at(-1) ?? path;
    expect(sec17, path).toContain(leaf);
  }

  it("section 17 tracks unlanded M4 directories under Not yet in the tree and drops landed ones", () => {
    const sec17 = section("## 17. ", "## 18. ");
    const pending = sec17.split("\n").find((line) => line.startsWith("Not yet in the tree")) ?? "";
    for (const path of [
      "src/budgets/",
      "src/layers/build/",
      "src/layers/html/",
      "src/layers/links/",
      "src/layers/bytes/",
      "src/layers/route-bytes/",
      "src/layers/axe/",
      "src/layers/size-limit/",
      "examples/astro-site/",
      "examples/web-app/",
    ]) {
      assertReservedOrLanded(sec17, pending, path);
    }
  });
});

describe("M4 G0c: M4 paths are reserved in every tool and layout scope", () => {
  const source = [
    "src/layers/build",
    "src/layers/html",
    "src/layers/links",
    "src/layers/bytes",
    "src/layers/route-bytes",
    "src/layers/axe",
    "src/layers/size-limit",
  ];
  const examples = ["examples/astro-site", "examples/web-app"];
  const prettier = join(root, "node_modules/prettier/bin/prettier.cjs");
  const made: string[] = [];

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const eslint = new ESLint({ cwd: root });
  const ignoredByPrettier = (path: string): unknown => {
    const result = spawnSync(process.execPath, [prettier, "--file-info", path], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const info: unknown = JSON.parse(result.stdout);
    return get(info, "ignored");
  };

  it.each(source)("ESLint lints %s at complexity error 4", async (dir) => {
    for (const file of [`${dir}/x.ts`, `${dir}/x.test.ts`]) {
      expect(await eslint.isPathIgnored(join(root, file)), file).toBe(false);
      const config: unknown = await eslint.calculateConfigForFile(join(root, file));
      expect(get(get(config, "rules"), "complexity"), file).toEqual([2, 4]);
    }
  });

  it.skipIf(insideStryker).each(source)("Prettier checks %s", (dir) => {
    expect(ignoredByPrettier(`${dir}/x.ts`)).toBe(false);
  });

  it.skipIf(insideStryker).each(examples)("%s is skipped by root Prettier", (dir) => {
    expect(ignoredByPrettier(`${dir}/src/x.ts`)).toBe(true);
  });

  it.each(examples)("%s is ignored by knip", (dir) => {
    expect(
      knipConfig.ignore.some((glob) => matchesGlob(`${dir}/src/x.ts`, glob)),
      dir,
    ).toBe(true);
  });

  it.each(source)("knip does not ignore %s", (dir) => {
    expect(
      knipConfig.ignore.some((glob) => matchesGlob(`${dir}/x.ts`, glob)),
      dir,
    ).toBe(false);
  });

  it("tsconfig includes every M4 source path and leaves the M4 examples out", () => {
    const read = ts.readConfigFile(join(root, "tsconfig.json"), (file) => ts.sys.readFile(file));
    const dir = mkdtempSync(join(tmpdir(), "wt-tsconfig-m4-"));
    made.push(dir);
    for (const name of [...source, ...examples].map((path) => `${path}/x.ts`)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), "export const x = 1;\n");
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir);
    expect(parsed.fileNames.map((name) => name.slice(dir.length + 1)).sort()).toEqual(
      source.map((path) => `${path}/x.ts`).sort(),
    );
  });

  const test = vitestConfig.test;
  const coverage = test?.coverage;
  const matches = (file: string, globs: readonly string[] | undefined): boolean =>
    (globs ?? []).some((glob) => matchesGlob(file, glob));
  const collected = (file: string): boolean =>
    matches(file, test?.include) && !matches(file, test?.exclude);

  it.each(source)("Vitest collects tests and coverage in %s", (dir) => {
    expect(collected(`${dir}/x.test.ts`)).toBe(true);
    expect(matches(`${dir}/x.ts`, coverage?.include)).toBe(true);
    expect(matches(`${dir}/x.ts`, coverage?.exclude)).toBe(false);
  });

  it.each(examples)("Vitest collects nothing in %s", (dir) => {
    expect(collected(`${dir}/x.test.ts`)).toBe(false);
  });

  describe.skipIf(insideStryker)("dependency-cruiser", () => {
    const depcruise = join(root, "node_modules/.bin/depcruise");
    const config = join(root, ".dependency-cruiser.cjs");
    const circular = (dir: string): Readonly<Record<string, string>> => ({
      [`${dir}/a.ts`]: 'import { b } from "./b.ts";\nexport const a = b;\n',
      [`${dir}/b.ts`]: 'import { a } from "./a.ts";\nexport const b = a;\n',
    });

    function project(files: Readonly<Record<string, string>>): string {
      const dir = mkdtempSync(join(tmpdir(), "wt-depcruise-m4-"));
      made.push(dir);
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "probe", type: "module" }));
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            module: "preserve",
            moduleResolution: "bundler",
            noEmit: true,
            allowImportingTsExtensions: true,
          },
          include: ["src", "packages", "fixtures", "examples"],
        }),
      );
      symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
      for (const [name, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, name)), { recursive: true });
        writeFileSync(join(dir, name), text);
      }
      return dir;
    }

    function cruise(cwd: string, target: string): { status: number | null; out: string } {
      const result = spawnSync(depcruise, [target, "--config", config], {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: result.status, out: result.stdout + result.stderr };
    }

    it.each(source)(
      "refuses a cycle in %s",
      (dir) => {
        const { status, out } = cruise(project(circular(dir)), dir);
        expect(out).toContain("no-circular");
        expect(status).not.toBe(0);
      },
      30_000,
    );

    it.each(examples)(
      "does not cruise %s",
      (dir) => {
        const files = { ...circular(dir), "src/ok.ts": "export const ok = 1;\n" };
        const { status, out } = cruise(project(files), dir);
        expect(out).not.toContain("no-circular");
        expect(status).toBe(0);
      },
      30_000,
    );
  });
});

describe("M4 G0d: schema and config validate M4 build, routes, budgets, and size_limit.skip_private", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const HEAD = 'protocol: "0.3.0"\nversion: "0.1.0"\npackage: pkg\nclass: web-app\n';

  it("validates astro-site and web-app example configs with build, routes, and budgets", () => {
    const astro = loadConfig(join(root, "fixtures/config/examples/astro-site.yaml"));
    expect(astro.ok).toBe(true);
    const webapp = loadConfig(join(root, "fixtures/config/examples/web-app.yaml"));
    expect(webapp.ok).toBe(true);
  });

  it.each([
    ["blank build.command", `${HEAD}build:\n  command: "  "\n`],
    ["absolute build.dir", `${HEAD}build:\n  dir: /dist\n`],
    ["parent traversal build.dir", `${HEAD}build:\n  dir: ../dist\n`],
    ["unknown build key", `${HEAD}build:\n  extra: 1\n`],
    ["empty routes", `${HEAD}routes: []\n`],
    ["duplicate routes", `${HEAD}routes: ["/", "/"]\n`],
    ["route missing slash", `${HEAD}routes: ["docs"]\n`],
    ["negative budget", `${HEAD}budgets:\n  route_js_bytes: -1\n`],
    ["float budget", `${HEAD}budgets:\n  page_js_bytes: 12.5\n`],
    ["unknown budgets key", `${HEAD}budgets:\n  extra: 1\n`],
    ["bad budgets.pages key", `${HEAD}budgets:\n  pages:\n    docs: 100\n`],
    ["bad budgets.entries key", `${HEAD}budgets:\n  entries:\n    index: 100\n`],
    ["blank size_limit.skip_private", `${HEAD}layers:\n  size_limit:\n    skip_private: "  "\n`],
  ])("rejects invalid config: %s", (_label, yaml) => {
    expect(parseConfig(yaml).ok).toBe(false);
  });

  it("enforces private: true for layers.size_limit.skip_private", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-m4-skip-"));
    made.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ private: false }));
    writeFileSync(
      join(dir, "web-tops.yaml"),
      'protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: ts-library\nenforce: hard\nlayers:\n  size_limit:\n    skip_private: never published\n',
    );
    expect(checkConfigFile(join(dir, "web-tops.yaml")).ok).toBe(false);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true }));
    expect(checkConfigFile(join(dir, "web-tops.yaml")).ok).toBe(true);
  });
});
