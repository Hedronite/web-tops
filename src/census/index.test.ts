import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { realExec } from "../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import type { Exec } from "../gate/types.ts";
import { censusFindings } from "./index.ts";
import type { CensusInput } from "./index.ts";

const root = resolve(import.meta.dirname, "../..");
const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(files: Readonly<Record<string, string>>): string {
  mkdirSync(join(root, "tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, "tmp", "wt-census-idx-"));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const noExec: Exec = () => Promise.reject(new Error("no process should start"));

const inputFor = (dir: string, files: readonly string[], exec: Exec = noExec): CensusInput => ({
  cwd: dir,
  files,
  exec,
  env: process.env,
  outDir: join(dir, ".web-tops", "out"),
});

const summary = (found: readonly { rule: string; file?: string; line?: number }[]): string[] =>
  found.map((item) => `${item.rule}:${item.file ?? ""}:${String(item.line ?? "")}`);

describe("censusFindings: the directives of a project, as findings", () => {
  const SOURCE = [
    "// @ts-expect-error: why",
    "export const a: number = 'x';",
    "/* eslint-disable no-console */",
    "export const b = 1;",
  ].join("\n");

  it("gives one pass finding per directive, rule census/<kind>, with its file and line, from tracked files only", async () => {
    const dir = project({ "src/a.ts": SOURCE, "src/untracked.ts": "// @ts-ignore\n" });
    const found = await censusFindings(inputFor(dir, ["src/a.ts"]));
    expect(summary(found)).toEqual([
      "census/ts-expect-error:src/a.ts:1",
      "census/eslint-disable:src/a.ts:3",
    ]);
    expect(found.every((item) => item.verdict === "pass" && item.tool === "webtops")).toBe(true);
    expect(found[0]?.message).toContain("@ts-expect-error");
  });

  it("reads each kind of file: styles, markup and Astro too", async () => {
    const dir = project({
      "src/a.css": "/* stylelint-disable */\n",
      "src/b.html": "<!-- [html-validate-disable] -->\n",
      "src/c.astro": "---\n// @ts-nocheck\n---\n<p/>\n",
      "README.md": "<!-- eslint-disable -->\n",
    });
    const found = await censusFindings(
      inputFor(dir, ["src/a.css", "src/b.html", "src/c.astro", "README.md"]),
    );
    expect(summary(found)).toEqual([
      "census/stylelint-disable:src/a.css:1",
      "census/html-validate-disable:src/b.html:1",
      "census/ts-nocheck:src/c.astro:2",
    ]);
  });

  it.each([
    "node_modules/pkg/a.ts",
    "dist/a.ts",
    "coverage/a.ts",
    ".web-tops/a.ts",
    "pkg/.astro/a.ts",
    "packages/x/dist/a.ts",
  ])(
    "does not read %s: output and dependency folders hold no source of the project's own",
    async (file) => {
      const dir = project({ [file]: "// @ts-ignore\n" });
      expect(await censusFindings(inputFor(dir, [file]))).toEqual([]);
    },
  );

  it("reads a folder that only shares a name, such as src/dist-tools/", async () => {
    const dir = project({ "src/dist-tools/a.ts": "// @ts-ignore\n" });
    expect(summary(await censusFindings(inputFor(dir, ["src/dist-tools/a.ts"])))).toEqual([
      "census/ts-ignore:src/dist-tools/a.ts:1",
    ]);
  });

  it("is empty for a project with nothing to count, and starts no process when there is no ESLint config", async () => {
    const dir = project({ "src/a.ts": "export const a = 1;\n" });
    expect(await censusFindings(inputFor(dir, ["src/a.ts"]))).toEqual([]);
  });
});

describe("censusFindings: configuration, read through the project's own tools", () => {
  it(
    "counts ignored files, per-file rule-offs and excluded files, with real ESLint and TypeScript",
    async () => {
      const dir = project({
        "eslint.config.js": [
          'import tseslint from "typescript-eslint";',
          "export default [",
          '  { ignores: ["src/legacy/**"] },',
          '  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, plugins: { "@typescript-eslint": tseslint.plugin }, rules: { "@typescript-eslint/no-explicit-any": "error" } },',
          '  { files: ["src/loose/**"], rules: { "@typescript-eslint/no-explicit-any": "off" } },',
          "];",
        ].join("\n"),
        "tsconfig.json": JSON.stringify({
          compilerOptions: { noEmit: true, types: [] },
          include: ["src"],
          exclude: ["src/gen/**"],
        }),
        "src/ok.ts": "export const ok = 1;\n",
        "src/legacy/a.ts": "export const a = 1;\n",
        "src/legacy/b.tsx": "export const b = 1;\n",
        "src/legacy/c.mjs": "export const c = 1;\n",
        "src/legacy/d.astro": "<p/>\n",
        "src/loose/l.ts": "export const l: any = 1;\n",
        "src/gen/g.ts": "export const g = 1;\n",
      });
      const files = [
        "eslint.config.js",
        "tsconfig.json",
        "src/ok.ts",
        "src/legacy/a.ts",
        "src/legacy/b.tsx",
        "src/legacy/c.mjs",
        "src/legacy/d.astro",
        "src/loose/l.ts",
        "src/gen/g.ts",
      ];
      const found = await censusFindings(inputFor(dir, files, realExec));
      expect(summary(found)).toEqual([
        "census/eslint-ignores:src/legacy/a.ts:",
        "census/eslint-ignores:src/legacy/b.tsx:",
        "census/eslint-ignores:src/legacy/c.mjs:",
        "census/eslint-ignores:src/legacy/d.astro:",
        "census/eslint-rule-off:src/loose/l.ts:",
        "census/tsconfig-exclude:src/gen/g.ts:",
      ]);
      expect(found[4]?.message).toBe(
        "@typescript-eslint/no-explicit-any: a per-file ESLint setting turns a rule off for this file",
      );
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "gives two rule-off findings for one file different fingerprints' anchors: the rule is in the message",
    async () => {
      const dir = project({
        "eslint.config.js": [
          "export default [",
          '  { files: ["**/*.ts"], rules: { "no-var": "error", "no-console": "error" } },',
          '  { files: ["src/l/**"], rules: { "no-var": "off", "no-console": "off" } },',
          "];",
        ].join("\n"),
        "src/ok.ts": "export const ok = 1;\n",
        "src/l/l.ts": "export const l = 1;\n",
      });
      const found = await censusFindings(
        inputFor(dir, ["eslint.config.js", "src/ok.ts", "src/l/l.ts"], realExec),
      );
      expect(found.map((item) => item.message.split(":")[0])).toEqual(["no-console", "no-var"]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "is a failing finding, not a zero, when ESLint cannot read the config",
    async () => {
      const dir = project({
        "eslint.config.js": "export default [ nope ];",
        "src/a.ts": "export const a = 1;\n",
      });
      const found = await censusFindings(inputFor(dir, ["eslint.config.js", "src/a.ts"], realExec));
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ rule: "census-eslint-unreadable", verdict: "fail" });
    },
    REAL_TOOL_TIMEOUT,
  );

  it("is a failing finding when tsconfig.json cannot be read", async () => {
    const dir = project({ "tsconfig.json": "{ nope", "src/a.ts": "export const a = 1;\n" });
    const found = await censusFindings(inputFor(dir, ["tsconfig.json", "src/a.ts"]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: "census-tsconfig-unreadable", verdict: "fail" });
  });

  it("asks ESLint only about the tracked scripts and Astro files outside the output folders", async () => {
    const dir = project({ "eslint.config.js": "export default [];" });
    let asked: unknown;
    const exec: Exec = (_command, _args, options) => {
      const list = Reflect.get(options?.env ?? {}, "WEBTOPS_CENSUS_FILES");
      asked = JSON.parse(readFileSync(String(list), "utf8"));
      return Promise.resolve({ code: 0, stdout: '{"ignored":{},"levels":{}}', stderr: "" });
    };
    const files = [
      "src/a.ts",
      "src/b.tsx",
      "src/c.astro",
      "dist/d.js",
      "node_modules/p/e.ts",
      "README.md",
      "src/style.css",
    ];
    await censusFindings(inputFor(dir, files, exec));
    expect(asked).toEqual(["src/a.ts", "src/b.tsx", "src/c.astro"]);
  });

  it("asks ESLint about no file, and starts nothing, when none of the tracked files is one it lints", async () => {
    const dir = project({ "eslint.config.js": "export default [];", "README.md": "hi\n" });
    expect(await censusFindings(inputFor(dir, ["README.md"]))).toEqual([]);
  });
});

describe("censusFindings: the words of a finding", () => {
  it("says the kind's sentence for a file-level item, with no rule in front of it", async () => {
    const dir = project({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { noEmit: true, types: [] },
        include: ["src"],
        exclude: ["src/gen/**"],
      }),
      "src/a.ts": "export const a = 1;\n",
      "src/gen/g.ts": "export const g = 1;\n",
    });
    const found = await censusFindings(
      inputFor(dir, ["tsconfig.json", "src/a.ts", "src/gen/g.ts"]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toBe("the tsconfig exclude leaves this file out of the program");
  });

  it(
    "says the kind's sentence for an ignored file",
    async () => {
      const dir = project({
        "eslint.config.js": 'export default [{ ignores: ["src/old/**"] }];',
        "src/old/a.ts": "export const a = 1;\n",
      });
      const found = await censusFindings(
        inputFor(dir, ["eslint.config.js", "src/old/a.ts"], realExec),
      );
      expect(found.map((item) => item.message)).toEqual([
        "an ESLint ignores entry leaves this file out of linting",
      ]);
    },
    REAL_TOOL_TIMEOUT,
  );
});
