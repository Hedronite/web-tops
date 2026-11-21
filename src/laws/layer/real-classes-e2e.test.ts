import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, tempDir } from "../probe/testkit.ts";

/**
 * R106 on a real project, with the project's own ESLint: the laws layer runs in a child process, so this covers the
 * process boundary and the tools, not the layer's code, which the pure tests beside it judge. Not run inside a Stryker
 * worker, as the real end to end test of the layer: it covers none of the code under mutation.
 */

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../../..");
const ASTRO = "astro/no-deprecated-astro-resolve";
const SLOW = 120_000;
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

/** A law whose Astro rule holds for astro-site only: nothing in the project enables it. */
const LAW = JSON.stringify({
  id: "W-22",
  severity: "R",
  reader: "tl",
  classes: ["ui-components", "astro-site"],
  judged: true,
  rules: [
    { tool: "eslint", name: "@typescript-eslint/no-explicit-any" },
    { tool: "eslint", name: ASTRO, classes: ["astro-site"] },
  ],
});

const CONFIG = [
  'import tseslint from "typescript-eslint";',
  "export default tseslint.config(",
  '  { files: ["**/*.ts"], extends: [tseslint.configs.strictTypeChecked], languageOptions: { parserOptions: { projectService: true } } },',
  ");",
  "",
].join("\n");

function layerScript(): string {
  return [
    `const root = process.env.WT_REPO;`,
    `const { realExec } = await import(root + "/src/gate/exec.ts");`,
    `const { lawsLayer } = await import(root + "/src/laws/layer/index.ts");`,
    `const { cfg } = await import(root + "/src/gate/testkit.ts");`,
    `const cwd = process.argv[1];`,
    `const laws = [JSON.parse(process.env.WT_LAW)];`,
    `const result = await lawsLayer(() => laws).run({`,
    `  cwd, config: cfg({ class: process.env.WT_CLASS }), base: "origin/main", enforce: "hard",`,
    `  env: { PATH: process.env.PATH ?? "" }, exec: realExec, outDir: cwd + "/.web-tops/out",`,
    `  artifacts: new Map([["eslint-json", cwd + "/out/e.json"], ["tsc-diagnostics", cwd + "/out/t.json"]]),`,
    `});`,
    `process.stdout.write(JSON.stringify(result.findings.map((found) => [found.rule, found.verdict, found.message])));`,
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
  symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
  mkdirSync(join(cwd, "src"));
  mkdirSync(join(cwd, "out"));
  writeFileSync(join(cwd, "package.json"), '{ "type": "module" }\n');
  writeFileSync(
    join(cwd, "tsconfig.json"),
    '{ "compilerOptions": { "strict": true, "target": "es2022", "module": "nodenext" }, "include": ["src"] }',
  );
  writeFileSync(join(cwd, "src/a.ts"), "export const a: number = 1;\n");
  writeFileSync(join(cwd, "eslint.config.js"), CONFIG);
  writeFileSync(join(cwd, "out/e.json"), "[]\n");
  writeFileSync(join(cwd, "out/t.json"), "[]\n");
  git(cwd, "init", "-q");
  git(cwd, "add", "-A");
  return cwd;
}

/** The layer's findings as [rule, verdict, message], read from the child's one line of JSON. */
function findingsFor(className: string): unknown {
  const cwd = project();
  const done = spawnSync("bun", ["-e", layerScript(), cwd], {
    cwd,
    env: { ...process.env, WT_REPO: REPO, WT_LAW: LAW, WT_CLASS: className },
    encoding: "utf8",
  });
  if (done.status !== 0) {
    throw new Error(`the layer did not run: ${done.stderr}`);
  }
  const parsed: unknown = JSON.parse(done.stdout);
  return parsed;
}

describe.skipIf(insideStryker)("R106 the laws layer on a real project, by class", () => {
  it(
    "does not require the Astro-only rule of a ui-components project, though nothing enables it",
    () => {
      const found = findingsFor("ui-components");
      expect(found).toEqual([["law/W-22", "pass", "W-22 pass"]]);
    },
    SLOW,
  );

  it(
    "refuses an astro-site project that does not enable it, at the config, with the rule named",
    () => {
      const found = findingsFor("astro-site");
      expect(found).toEqual([
        ["law/W-22", "refuse", "W-22 refuse: 1 place(s) listed"],
        [ASTRO, "refuse", `${ASTRO} is not enabled for any file the project lints`],
      ]);
    },
    SLOW,
  );
});
