import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import { off } from "../../gate/testkit.ts";
import { HYGIENE_STEPS, type HygieneStep } from "../../gate/types.ts";
import {
  failures,
  fakeExec,
  prepare,
  recorded,
  runHygiene,
  FIXTURES,
  type Prepared,
} from "./testkit.ts";
import { readFileSync } from "node:fs";

const prepared: Prepared[] = [];

afterEach(() => {
  for (const item of prepared.splice(0)) {
    item.project.cleanup();
  }
});

function setup(files: Record<string, string>, real = false): Prepared {
  const item = prepare(files, { real });
  prepared.push(item);
  return item;
}

const ONLY = (keep: HygieneStep): Partial<Record<HygieneStep, ReturnType<typeof off>>> =>
  Object.fromEntries(
    HYGIENE_STEPS.filter((step) => step !== keep).map((step) => [step, off("not under test")]),
  );

/** The real tools resolve from the linked `node_modules`; PATH only has to find node. */
const REAL_PATH = process.env["PATH"] ?? "";

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2023",
    module: "Preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    types: [],
  },
  include: ["src"],
});
const COMPOSITE = JSON.stringify({
  compilerOptions: {
    target: "ES2023",
    module: "Preserve",
    moduleResolution: "bundler",
    strict: true,
    composite: true,
    declaration: true,
    rootDir: "src",
    types: [],
  },
  include: ["src"],
});

describe("G3b hygiene: observed forms on the pins (tsc -b --noEmit, bun audit)", () => {
  it.each([
    ["a plain project", TSCONFIG],
    ["a composite project", COMPOSITE],
  ])(
    "tsc -b --noEmit on 6.0.3 exits 0 for a clean %s and writes only the build info",
    async (_label, tsconfig) => {
      const item = setup(
        {
          "tsconfig.json": tsconfig,
          "src/index.ts": "export const a: number = 1;\n",
        },
        true,
      );
      const result = await runHygiene(item, realExec, {
        env: { PATH: REAL_PATH },
        steps: ONLY("tsc"),
      });
      expect(failures(result)).toEqual([]);
      expect(result.verdict).toBe("pass");
    },
  );

  it("tsc -b --noEmit exits 1 on a type error, which the layer reports with its file and line", async () => {
    const item = setup(
      {
        "tsconfig.json": TSCONFIG,
        "src/index.ts": 'export const a: number = "s";\n',
      },
      true,
    );
    const result = await runHygiene(item, realExec, {
      env: { PATH: REAL_PATH },
      steps: ONLY("tsc"),
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: "TS2322", file: "src/index.ts", line: 1, verdict: "Refuse" }),
    );
  });

  it("the audit reader takes the three shapes bun audit 1.4.4 prints: {} clean, an object by package, nothing", async () => {
    const item = setup({ "package.json": "{}" });
    const shapes = {
      clean: recorded("audit-clean.json"),
      vulnerable: recorded("audit-vulnerable.json"),
    };
    const clean = await runHygiene(
      item,
      fakeExec(item.project.dir, {
        "bun audit": () => ({ code: 0, stdout: shapes.clean, stderr: "" }),
      }).exec,
    );
    const vulnerable = await runHygiene(
      item,
      fakeExec(item.project.dir, {
        "bun audit": () => ({ code: 1, stdout: shapes.vulnerable, stderr: "" }),
      }).exec,
    );
    const empty = await runHygiene(
      item,
      fakeExec(item.project.dir, {
        "bun audit": () => ({ code: 1, stdout: "", stderr: "error: nope" }),
      }).exec,
    );
    expect([clean.verdict, vulnerable.verdict, empty.verdict]).toEqual([
      "pass",
      "Refuse",
      "Refuse",
    ]);
    expect(failures(empty)).toEqual(["output-empty"]);
  });

  it("ESLint runs for real once and its JSON file stays on disk, with findings from a planted unused variable", async () => {
    const item = setup(
      {
        "eslint.config.js":
          'export default [{ files: ["**/*.js"], rules: { "no-unused-vars": "error" } }];\n',
        "src/bad.js": "const unused = 1;\n",
      },
      true,
    );
    const result = await runHygiene(item, realExec, {
      env: { PATH: REAL_PATH },
      steps: ONLY("eslint"),
      settings: { eslintConfig: "eslint.config.js" },
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ rule: "no-unused-vars", file: "src/bad.js", line: 1 }),
    );
    const path = result.artifacts["eslint-json"] ?? "";
    expect(JSON.parse(readFileSync(path, "utf8"))).toBeInstanceOf(Array);
  });
});

function packageJson(name: string): string {
  return readFileSync(join(FIXTURES, name, "package.json"), "utf8");
}

describe("R18: attw runs with --profile esm-only only for an ESM-only package", () => {
  it("passes an ESM-only tarball with the profile, and records which profile ran", async () => {
    const item = setup({ "package.json": packageJson("pkg-esm-only") });
    const fake = fakeExec(item.project.dir, {
      attw: (args) =>
        args.includes("--profile")
          ? { code: 0, stdout: recorded("attw-esm-only-profile.json"), stderr: "" }
          : { code: 1, stdout: recorded("attw-esm-only-plain.json"), stderr: "" },
    });
    const result = await runHygiene(item, fake.exec);
    expect(fake.calls.find((call) => call.tool === "attw")?.args.slice(-2)).toEqual([
      "--profile",
      "esm-only",
    ]);
    expect(result.verdict).toBe("pass");
    expect(result.findings).toContainEqual({
      rule: "attw-profile",
      verdict: "pass",
      message: "attw ran with --profile esm-only: type module and no require condition in exports",
    });
  });

  it("fails the same tarball when run plain, with the problems attw lists", async () => {
    const item = setup({
      "package.json": JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        exports: { ".": "./dist/index.js" },
      }),
    });
    const fake = fakeExec(item.project.dir, {
      attw: () => ({ code: 1, stdout: recorded("attw-esm-only-plain.json"), stderr: "" }),
    });
    const result = await runHygiene(item, fake.exec);
    expect(fake.calls.find((call) => call.tool === "attw")?.args).not.toContain("--profile");
    expect(result.findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining(["attw:NoResolution", "attw:CJSResolvesToESM"]),
    );
    expect(result.verdict).toBe("Refuse");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule: "attw-profile",
        message: "attw ran with its default profile",
      }),
    );
  });

  it("runs a dual package plain, and fails it for the require target it does not ship", async () => {
    const item = setup({ "package.json": packageJson("pkg-dual-broken") });
    const fake = fakeExec(item.project.dir, {
      publint: () => ({ code: 1, stdout: recorded("publint-dual-broken.txt"), stderr: "" }),
      attw: () => ({ code: 1, stdout: recorded("attw-dual-broken-plain.json"), stderr: "" }),
    });
    const result = await runHygiene(item, fake.exec);
    expect(fake.calls.find((call) => call.tool === "attw")?.args).not.toContain("--profile");
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule: "publint",
        message:
          'pkg.exports["."].require.types is ./dist/index.d.cts but the file does not exist.',
      }),
    );
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "attw:NoResolution" }));
    expect(result.findings.filter((finding) => finding.rule === "publint")).toHaveLength(2);
    expect(result.verdict).toBe("Refuse");
  });

  it("does not fail on publint suggestions or warnings, only on its Errors list", async () => {
    const item = setup({ "package.json": packageJson("pkg-esm-only") });
    const text = "Running publint\nLinting...\nSuggestions:\n1. add engines.node\n";
    const fake = fakeExec(item.project.dir, {
      publint: () => ({ code: 1, stdout: text, stderr: "" }),
    });
    const result = await runHygiene(item, fake.exec);
    expect(result.findings.filter((finding) => finding.rule === "publint")).toHaveLength(1);
    expect(result.findings.find((finding) => finding.rule === "publint")?.message).toContain(
      "publint exited 1",
    );
  });

  it("reports pack failures and attw crashes as their own findings", async () => {
    const item = setup({ "package.json": packageJson("pkg-esm-only") });
    const noTarball = await runHygiene(
      item,
      fakeExec(item.project.dir, { "bun pm": () => ({ code: 0, stdout: "", stderr: "" }) }).exec,
    );
    expect(failures(noTarball)).toEqual(["pack-failed"]);
    const crash = await runHygiene(
      item,
      fakeExec(item.project.dir, { attw: () => ({ code: 3, stdout: "", stderr: "ENOENT" }) }).exec,
    );
    expect(failures(crash)).toEqual(["attw-failed"]);
    mkdirSync(join(item.outDir, "x"), { recursive: true });
    writeFileSync(join(item.outDir, "x", "y"), "");
  });
});
