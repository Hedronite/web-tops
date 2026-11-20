import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, tempDir } from "../probe/testkit.ts";

/**
 * The laws layer on a real project, with the project's own ESLint and TypeScript. The layer runs in a child process, so
 * what is covered here is the process boundary and the tools, not the layer's code, which has its own tests.
 */

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../../..");
const ANY = "@typescript-eslint/no-explicit-any";
const SLOW = 120_000;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "es2022",
    module: "nodenext",
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    erasableSyntaxOnly: true,
  },
  include: ["src"],
});

/** The config of a project that lints its TypeScript with the strict type-checked preset; `extra` is one more block. */
function config(extra: string): string {
  return [
    'import tseslint from "typescript-eslint";',
    "export default tseslint.config(",
    '  { files: ["**/*.ts"], extends: [tseslint.configs.strictTypeChecked], languageOptions: { parserOptions: { projectService: true } } },',
    extra,
    ");",
    "",
  ].join("\n");
}

/** The script the child process runs: the real layer with the real exec and readers, over W-01 and W-04 of the catalog. */
function layerScript(): string {
  return [
    `const root = process.env.WT_REPO;`,
    `const { realExec } = await import(root + "/src/gate/exec.ts");`,
    `const { lawsLayer } = await import(root + "/src/laws/layer/index.ts");`,
    `const { yamlCatalog } = await import(root + "/src/laws/layer/catalog.ts");`,
    `const { cfg } = await import(root + "/src/gate/testkit.ts");`,
    `const cwd = process.argv[1];`,
    `const laws = yamlCatalog().filter((law) => law.id === "W-01" || law.id === "W-04");`,
    `const result = await lawsLayer(() => laws).run({`,
    `  cwd, config: cfg({ class: "ts-library" }), base: "origin/main", enforce: "hard",`,
    `  env: { PATH: process.env.PATH ?? "" }, exec: realExec, outDir: cwd + "/.web-tops/out",`,
    `  artifacts: new Map([["eslint-json", cwd + "/out/e.json"], ["tsc-diagnostics", cwd + "/out/t.json"]]),`,
    `});`,
    `process.stdout.write(JSON.stringify({ verdict: result.verdict, findings: result.findings }));`,
  ].join("\n");
}

interface Answer {
  readonly verdict: string;
  readonly findings: readonly {
    readonly rule: string;
    readonly verdict: string;
    readonly file?: string;
    readonly line?: number;
    readonly message: string;
  }[];
}

function isAnswer(value: unknown): value is Answer {
  return typeof value === "object" && value !== null && "verdict" in value && "findings" in value;
}

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (done.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
  }
}

function project(eslintConfig: string): string {
  const cwd = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
  mkdirSync(join(cwd, "src"));
  mkdirSync(join(cwd, "out"));
  writeFileSync(join(cwd, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(cwd, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(cwd, "src/a.ts"), "export const a: number = 1;\n");
  writeFileSync(join(cwd, "eslint.config.js"), eslintConfig);
  writeFileSync(join(cwd, "out/e.json"), "[]\n");
  writeFileSync(join(cwd, "out/t.json"), "[]\n");
  git(cwd, "init", "-q");
  git(cwd, "add", "-A");
  return cwd;
}

function judge(eslintConfig: string): Answer {
  const cwd = project(eslintConfig);
  const done = spawnSync("bun", ["-e", layerScript(), cwd], {
    cwd,
    env: { ...process.env, WT_REPO: REPO },
    encoding: "utf8",
  });
  if (done.status !== 0) {
    throw new Error(`the layer did not run: ${done.stderr}`);
  }
  const parsed: unknown = JSON.parse(done.stdout);
  if (!isAnswer(parsed)) {
    throw new Error(`the layer answered something else: ${done.stdout}`);
  }
  return parsed;
}

const lawOf = (answer: Answer, id: string): Answer["findings"][number] | undefined =>
  answer.findings.find((found) => found.rule === `law/${id}`);

/**
 * Not run inside a Stryker worker: it starts bun, ESLint and tsc as processes, covers none of the code under mutation (the
 * layer runs in the child), and so no mutant has it as its killer, while a slow runner can fail Stryker's initial run on it.
 */
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

describe.skipIf(insideStryker)(
  "G4 the laws layer on a project with real ESLint and real tsc",
  () => {
    it(
      "passes W-01 and W-04 when every rule is at error for every TypeScript file and every flag is set",
      () => {
        const answer = judge(config(""));
        expect(lawOf(answer, "W-01")?.verdict).toBe("pass");
        expect(lawOf(answer, "W-04")?.verdict).toBe("pass");
        expect(answer.verdict).toBe("pass");
      },
      SLOW,
    );

    it.each([
      ["off", "off"],
      ["warn", "warn"],
    ])(
      "refuses W-01 at the config line of an override that sets no-explicit-any to %s",
      (_name, level) => {
        const override = `  { files: ["src/**"], rules: { "${ANY}": "${level}" } },`;
        const text = config(override);
        const line = text.split("\n").indexOf(override) + 1;
        const answer = judge(text);
        expect(lawOf(answer, "W-01")?.verdict).toBe("refuse");
        expect(answer.verdict).toBe("refuse");
        const spot = answer.findings.find((found) => found.rule === ANY);
        expect(spot).toMatchObject({ verdict: "refuse", file: "eslint.config.js", line });
        expect(spot?.message).toBe(`${ANY} is below error for 1 file(s), such as src/a.ts`);
        expect(lawOf(answer, "W-04")?.verdict).toBe("pass");
      },
      SLOW,
    );

    it(
      "says why W-01 is not evaluated when the config reaches no TypeScript file, and refuses the file-set",
      () => {
        const answer = judge(`export default [{ rules: { "${ANY}": "error" } }];\n`);
        const reading = answer.findings.find((found) => found.rule === "law/W-01");
        expect(reading?.verdict).toBe("not-evaluated");
        expect(reading?.message).toContain("ESLint's config reaches no TypeScript file");
        expect(answer.findings.find((found) => found.rule === "file-set")).toMatchObject({
          verdict: "refuse",
          file: "src/a.ts",
        });
      },
      SLOW,
    );
  },
);
