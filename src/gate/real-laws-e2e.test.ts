import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";

/**
 * G4d on a real project: the gate runner, with the real laws layer and the project's own ESLint, writes a laws block
 * that validateReport accepts, counted from the layer's findings. The run is in a child process, so this covers the
 * process boundary and the tools, not the runner's code, which the tests beside it judge; it is not run inside a Stryker
 * worker.
 */

afterAll(cleanTemp);

const KIT = resolve(import.meta.dirname, "../..");
const SLOW = 120_000;
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

const CONFIG = [
  'import tseslint from "typescript-eslint";',
  "export default tseslint.config(",
  '  { files: ["**/*.ts"], extends: [tseslint.configs.strictTypeChecked], languageOptions: { parserOptions: { projectService: true } } },',
  ");",
  "",
].join("\n");

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

/** The script: runGate over a hygiene layer that writes the two artifacts the laws layer reads, and the real laws layer. */
function script(): string {
  return [
    `const root = process.env.WT_KIT;`,
    `const { runGate } = await import(root + "/src/gate/runner.ts");`,
    `const { lawsLayer } = await import(root + "/src/laws/layer/index.ts");`,
    `const { yamlCatalog } = await import(root + "/src/laws/layer/catalog.ts");`,
    `const { realExec } = await import(root + "/src/gate/exec.ts");`,
    `const { cfg, fakeLayer, opts } = await import(root + "/src/gate/testkit.ts");`,
    `const { validateReport } = await import(root + "/src/config/report.ts");`,
    `const cwd = process.argv[1];`,
    `const laws = yamlCatalog().filter((law) => ["W-01", "W-04"].includes(law.id));`,
    `const hygiene = fakeLayer({ id: "hygiene", gate: 1, artifacts: { "eslint-json": cwd + "/.web-tops/out/hygiene/e.json", "tsc-diagnostics": cwd + "/.web-tops/out/hygiene/t.json" } });`,
    `const report = await runGate({`,
    `  layers: [hygiene, lawsLayer(() => laws)], config: cfg({ class: "ts-library" }), options: opts(),`,
    `  cwd, env: { PATH: process.env.PATH ?? "" }, exec: realExec, outDir: cwd + "/.web-tops/out", now: Date.now,`,
    `});`,
    `const checked = validateReport(report);`,
    `const wrong = checked.ok ? [] : checked.problems.map((problem) => problem.pointer);`,
    `process.stdout.write(JSON.stringify({ laws: report.laws, wrong }));`,
  ].join("\n");
}

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (done.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
  }
}

function project(): string {
  const cwd = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(cwd, "node_modules"));
  mkdirSync(join(cwd, "src"));
  mkdirSync(join(cwd, ".web-tops", "out", "hygiene"), { recursive: true });
  writeFileSync(join(cwd, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(cwd, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(cwd, "src/a.ts"), "export const a: number = 1;\n");
  writeFileSync(join(cwd, "eslint.config.js"), CONFIG);
  writeFileSync(join(cwd, ".web-tops/out/hygiene/e.json"), "[]\n");
  writeFileSync(join(cwd, ".web-tops/out/hygiene/t.json"), "[]\n");
  git(cwd, "init", "-q");
  git(cwd, "add", "-A");
  return cwd;
}

describe.skipIf(insideStryker)(
  "the gate runner on a real project, with the real laws layer",
  () => {
    it(
      "writes a laws block of the laws layer's findings, and the report validates apart from the layers it did not run",
      () => {
        const cwd = project();
        const done = spawnSync("bun", ["-e", script(), cwd], {
          cwd,
          env: { ...process.env, WT_KIT: KIT },
          encoding: "utf8",
        });
        expect(done.status, done.stderr).toBe(0);
        const parsed: unknown = JSON.parse(done.stdout);
        expect(Reflect.get(Object(parsed), "laws")).toEqual({
          class: "ts-library",
          of: 2,
          judged: 2,
          refused: 0,
          not_evaluated: 0,
        });
        const wrong: unknown = Reflect.get(Object(parsed), "wrong");
        expect(wrong).toEqual(expect.not.arrayContaining(["/laws"]));
      },
      SLOW,
    );
  },
);
