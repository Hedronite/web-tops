import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { ESLint, RuleTester, type Rule } from "eslint";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";
import pkg from "../../package.json" with { type: "json" };
import vitestConfig from "../../vitest.config.ts";
import { TOOL_PINS } from "../lock/pins.ts";

const root = resolve(import.meta.dirname, "../..");
const spec = readFileSync(join(root, "WEB_TOPS.md"), "utf8");
const section = (from: string, to: string): string =>
  spec.slice(spec.indexOf(from), spec.indexOf(to));

function get(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

const NEW_TOOLS = [
  "knip",
  "eslint-plugin-react-hooks",
  "secretlint",
  "@secretlint/secretlint-rule-preset-recommend",
] as const;

describe("M3 G0a: knip, the secrets scanner and react-hooks are pinned exactly", () => {
  it.each(NEW_TOOLS)("%s is a devDependency at its exact pin", (name) => {
    expect(TOOL_PINS[name]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(get(pkg.devDependencies, name)).toBe(TOOL_PINS[name]);
  });

  it.each(NEW_TOOLS)("web-tops.lock records %s at its pin", (name) => {
    const escaped = name.replace(/[/@]/g, (char) => `\\${char}`);
    const line = new RegExp(`^"?${escaped}"?: ${TOOL_PINS[name].replaceAll(".", "\\.")}$`, "m");
    expect(readFileSync(join(root, "web-tops.lock"), "utf8")).toMatch(line);
  });

  it("section 2 names each at its full version, and the RuleTester path", () => {
    const pins = section("## 2. Pins", "## 3.");
    const row = pins.split("\n").find((line) => line.startsWith("| Law readers |")) ?? "";
    for (const name of NEW_TOOLS) expect(row).toContain(`\`${name}\` ${TOOL_PINS[name]}`);
    expect(pins).toContain("`RuleTester`");
  });
});

describe("R85: the twins' lint tools are exact kit devDependencies", () => {
  it.each(["eslint-plugin-jsx-a11y-x", "stylelint"] as const)(
    "%s is installed at its pin, and the lock records it",
    (name) => {
      expect(get(pkg.devDependencies, name)).toBe(TOOL_PINS[name]);
      const line = new RegExp(`^${name}: ${TOOL_PINS[name].replaceAll(".", "\\.")}$`, "m");
      expect(readFileSync(join(root, "web-tops.lock"), "utf8")).toMatch(line);
    },
  );
});

describe("M3 G0a: the secrets scanner runs under Node and Bun", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // The sample secret access key from the AWS documentation. It is a documented fake, and
  // secretlint's AWS rule flags it (the same page's AKIAIOSFODNN7EXAMPLE pair is on its allow list).
  const DOCUMENTED_FAKE = "je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY";
  const bin = join(root, "node_modules/secretlint/bin/secretlint.js");

  function scan(runtime: string, text: string): { status: number | null; out: string } {
    const dir = mkdtempSync(join(tmpdir(), "wt-secretlint-"));
    made.push(dir);
    const rc = join(dir, ".secretlintrc.json");
    writeFileSync(rc, JSON.stringify({ rules: [{ id: pkgName }] }));
    writeFileSync(join(dir, "input.txt"), text);
    const options = { cwd: root, encoding: "utf8" } as const;
    const result = spawnSync(runtime, [bin, "--secretlintrc", rc, join(dir, "input.txt")], options);
    return { status: result.status, out: result.stdout + result.stderr };
  }
  const pkgName = "@secretlint/secretlint-rule-preset-recommend";

  it.each([process.execPath, "bun"])(
    "%s: fails on the documented fake and names the rule",
    (run) => {
      const { status, out } = scan(run, `aws_secret_access_key = ${DOCUMENTED_FAKE}\n`);
      expect(out).toContain("AWSSecretAccessKey");
      expect(status).toBe(1);
    },
  );

  it.each([process.execPath, "bun"])("%s: passes clean text", (run) => {
    const { status, out } = scan(run, "nothing secret in this line\n");
    expect(out).toBe("");
    expect(status).toBe(0);
  });

  it("never prints the secret it found", () => {
    expect(scan(process.execPath, `key = ${DOCUMENTED_FAKE}\n`).out).not.toContain("EXAMPLEKEY");
  });
});

describe("M3 G0a: the RuleTester path runs under Vitest", () => {
  RuleTester.describe = describe;
  RuleTester.it = it;
  const noFoo: Rule.RuleModule = {
    meta: { type: "problem", schema: [], messages: { foo: "no foo" } },
    create: (context) => ({
      Identifier(node) {
        if (node.name === "foo") context.report({ node, messageId: "foo" });
      },
    }),
  };

  new RuleTester().run("no-foo", noFoo, {
    valid: ["const bar = 1;"],
    invalid: [{ code: "const foo = 1;", errors: [{ messageId: "foo" }] }],
  });
});

describe("M3 G0b: the M3 paths are in every tool's scope", () => {
  const source = [
    "src/laws",
    "src/layers/laws",
    "src/presets",
    "src/acks",
    "src/lawdiff",
    "packages/eslint-plugin-webtops/src",
  ];
  const data = ["fixtures/laws/W-01/bad", "fixtures/laws/W-01/clean"];
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
    });
    const info: unknown = JSON.parse(result.stdout);
    return get(info, "ignored");
  };

  it.each(source)("ESLint lints %s, at complexity error 4", async (dir) => {
    for (const file of [`${dir}/x.ts`, `${dir}/x.test.ts`]) {
      expect(await eslint.isPathIgnored(join(root, file)), file).toBe(false);
      const config: unknown = await eslint.calculateConfigForFile(join(root, file));
      expect(get(get(config, "rules"), "complexity"), file).toEqual([2, 4]);
    }
  });

  it.each(source)("Prettier checks %s", (dir) => {
    expect(ignoredByPrettier(`${dir}/x.ts`)).toBe(false);
  });

  it("Prettier checks laws/, the data files of every law", () => {
    expect(ignoredByPrettier("laws/W-01.yaml")).toBe(false);
  });

  it.each(data)("%s is data or its own project: skipped by lint and format", async (dir) => {
    expect(await eslint.isPathIgnored(join(root, `${dir}/x.ts`))).toBe(true);
    expect(await eslint.isPathIgnored(join(root, `${dir}/x.tsx`))).toBe(true);
    expect(ignoredByPrettier(`${dir}/x.ts`)).toBe(true);
  });

  it("examples/node-service is a project of its own: linted under its own config, formatted by its own gate, and reached by the root tsconfig references", async () => {
    expect(await eslint.isPathIgnored(join(root, "examples/node-service/src/x.ts"))).toBe(false);
    expect(ignoredByPrettier("examples/node-service/src/x.ts")).toBe(true);
    const read = ts.readConfigFile(join(root, "tsconfig.json"), (file) => ts.sys.readFile(file));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
    expect(parsed.projectReferences?.map((reference) => reference.path)).toEqual([
      join(root, "examples/node-service"),
    ]);
    expect(get(read.config, "exclude")).not.toContain("examples/node-service");
  });

  it("tsconfig includes every source path, and leaves the data paths out", () => {
    const read = ts.readConfigFile(join(root, "tsconfig.json"), (file) => ts.sys.readFile(file));
    const dir = mkdtempSync(join(tmpdir(), "wt-tsconfig-m3-"));
    made.push(dir);
    for (const name of [...source, ...data].map((path) => `${path}/x.ts`)) {
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

  it.each(source)("Vitest collects tests in %s", (dir) => {
    expect(collected(`${dir}/x.test.ts`)).toBe(true);
  });

  it.each(data)("Vitest collects nothing in %s", (dir) => {
    expect(collected(`${dir}/x.test.ts`)).toBe(false);
  });

  it.each(source)("coverage counts the sources in %s", (dir) => {
    expect(matches(`${dir}/x.ts`, coverage?.include)).toBe(true);
    expect(matches(`${dir}/x.ts`, coverage?.exclude)).toBe(false);
  });

  describe("dependency-cruiser", () => {
    const depcruise = join(root, "node_modules/.bin/depcruise");
    const config = join(root, ".dependency-cruiser.cjs");
    const circular = (dir: string): Readonly<Record<string, string>> => ({
      [`${dir}/a.ts`]: 'import { b } from "./b.ts";\nexport const a = b;\n',
      [`${dir}/b.ts`]: 'import { a } from "./a.ts";\nexport const b = a;\n',
    });

    function project(files: Readonly<Record<string, string>>): string {
      const dir = mkdtempSync(join(tmpdir(), "wt-depcruise-m3-"));
      made.push(dir);
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "probe", type: "module" }));
      const options = { module: "preserve", moduleResolution: "bundler", noEmit: true };
      const include = ["src", "packages", "fixtures", "examples"];
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { ...options, allowImportingTsExtensions: true },
          include,
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
      const result = spawnSync(depcruise, [target, "--config", config], { cwd, encoding: "utf8" });
      return { status: result.status, out: result.stdout + result.stderr };
    }

    it.each(source)(
      "refuses a cycle in %s",
      (dir) => {
        const { status, out } = cruise(project(circular(dir)), dir.split("/")[0] ?? dir);
        expect(out).toContain("no-circular");
        expect(status).not.toBe(0);
      },
      30_000,
    );

    it.each(data)(
      "does not cruise %s",
      (dir) => {
        const files = { ...circular(dir), "src/ok.ts": "export const ok = 1;\n" };
        const { status, out } = cruise(project(files), dir.split("/")[0] ?? dir);
        expect(out).not.toContain("no-circular");
        expect(status).toBe(0);
      },
      30_000,
    );
  });
});

describe("M3 G0b: the kit's Vitest config, exactly", () => {
  it("times tests out at 30 s, collects src and packages, and skips the data paths", () => {
    expect(vitestConfig).toEqual({
      test: {
        testTimeout: 30_000,
        include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
        exclude: [
          ...configDefaults.exclude,
          "probes/**",
          "fixtures/probe/**",
          "fixtures/complexity/**",
          "fixtures/laws/**",
          "examples/node-service/**",
        ],
        coverage: {
          provider: "v8",
          reporter: ["text", "json", "lcov"],
          reportsDirectory: "coverage",
          include: ["src/**/*.ts", "packages/**/*.ts"],
          exclude: [
            "src/**/*.test.ts",
            "src/**/test-support*.ts",
            "src/**/*.d.ts",
            "packages/**/*.test.ts",
            "packages/**/*.d.ts",
          ],
        },
      },
    });
  });
});

describe("M3 G0c: WEB_TOPS.md names fixtures/laws/W-NN/{bad,clean}/ and nothing of fixtures/lints", () => {
  const twins = "fixtures/laws/W-NN/{bad,clean}/";

  it("has no fixtures/lints left", () => {
    expect(spec).not.toContain("fixtures/lints");
  });

  it.each([
    ["8.1 Model", section("### 8.1 ", "### 8.2 ")],
    ["17 Repository layout", section("## 17.", "## 18.")],
  ])("section %s names the twin directories", (_name, text) => {
    expect(text).toContain(`\`${twins}\``);
  });
});
