import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, tempDir } from "../probe/testkit.ts";

/**
 * G9: the real secretlint (W-39) and the real knip (W-48), run by the readers registered in the laws layer. The layer
 * runs in a child process over a project with the project's own ESLint, so this covers the registry, the tools and the
 * process boundary, not the readers' code, which the tests beside them judge; it is not run inside a Stryker worker.
 */

afterAll(cleanTemp);

const KIT = resolve(import.meta.dirname, "../../..");
const SLOW = 240_000;
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

/** The documented fake: the sample secret access key of the AWS documentation. */
const FAKE = "je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY";
const LEAK = `export const ok = 1;\nconst aws_secret_access_key = "${FAKE}";\n`;
const INDEX = 'import { used } from "./utils.ts";\nexport const a = used;\n';

const CONFIG = [
  'import tseslint from "typescript-eslint";',
  "export default tseslint.config(",
  '  { files: ["**/*.ts"], extends: [tseslint.configs.strictTypeChecked], languageOptions: { parserOptions: { projectService: true } } },',
  ");",
  "",
].join("\n");

const ALLOWS = JSON.stringify({
  rules: [
    {
      id: "@secretlint/secretlint-rule-preset-recommend",
      rules: [
        {
          id: "@secretlint/secretlint-rule-aws",
          options: { allows: ["/je7MtGbClwBF\\/2Zp9Utk\\/h3yCo8nvbEXAMPLEKEY/"] },
        },
      ],
    },
  ],
});

interface Scenario {
  readonly name: string;
  readonly law: string;
  /** What the layer says of the law: a soft law's refusal is `ack-missing`. */
  readonly verdict: "pass" | "refuse" | "ack-missing";
  /** The tracked files of the project, besides the config the project's ESLint needs. */
  readonly files: Readonly<Record<string, string>>;
}

const SCENARIOS: readonly Scenario[] = [
  { name: "W-39 planted", law: "W-39", verdict: "refuse", files: { "src/leak.ts": LEAK } },
  {
    name: "W-39 clean",
    law: "W-39",
    verdict: "pass",
    files: { "src/clean.ts": "export const ok = 1;\n" },
  },
  {
    name: "W-39 allowed by the project's own config",
    law: "W-39",
    verdict: "pass",
    files: { "src/leak.ts": LEAK, ".secretlintrc.json": ALLOWS },
  },
  {
    name: "W-48 planted",
    law: "W-48",
    verdict: "ack-missing",
    files: {
      "index.ts": INDEX,
      "utils.ts": "export const used = 1;\nexport const unusedExport = 2;\n",
      "unused.ts": "export const lonely = 1;\n",
    },
  },
  {
    name: "W-48 planted, but ignored by the project's own knip config",
    law: "W-48",
    verdict: "pass",
    files: {
      "index.ts": INDEX,
      "utils.ts": "export const used = 1;\n",
      "unused.ts": "export const lonely = 1;\n",
      "knip.json": JSON.stringify({ ignore: ["eslint.config.js", "unused.ts"] }),
    },
  },
  {
    name: "W-48 clean",
    law: "W-48",
    verdict: "pass",
    files: { "index.ts": INDEX, "utils.ts": "export const used = 1;\n" },
  },
];

function script(): string {
  return [
    `const root = process.env.WT_KIT;`,
    `const { realExec } = await import(root + "/src/gate/exec.ts");`,
    `const { lawsLayer } = await import(root + "/src/laws/layer/index.ts");`,
    `const { yamlCatalog } = await import(root + "/src/laws/layer/catalog.ts");`,
    `const { cfg } = await import(root + "/src/gate/testkit.ts");`,
    `const scenarios = JSON.parse(process.env.WT_SCENARIOS);`,
    `const out = {};`,
    `for (const one of scenarios) {`,
    `  const laws = yamlCatalog().filter((law) => law.id === one.law);`,
    `  const result = await lawsLayer(() => laws).run({`,
    `    cwd: one.cwd, config: cfg({ class: "ts-library" }), base: "origin/main", enforce: "hard",`,
    `    env: { PATH: process.env.PATH ?? "" }, exec: realExec, outDir: one.cwd + "/.web-tops/out",`,
    `    artifacts: new Map([["eslint-json", one.cwd + "/out/e.json"], ["tsc-diagnostics", one.cwd + "/out/t.json"]]),`,
    `  });`,
    `  out[one.name] = result.findings.map((found) => [found.rule, found.verdict, found.file ?? null, found.line ?? null]);`,
    `}`,
    `process.stdout.write(JSON.stringify(out));`,
  ].join("\n");
}

function put(cwd: string, files: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, name)), { recursive: true });
    writeFileSync(join(cwd, name), text);
  }
}

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (done.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
  }
}

/** A project of one scenario, its files committed: the scanner reads what git tracks. */
function project(one: Scenario): string {
  const cwd = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(cwd, "node_modules"));
  put(cwd, {
    ".gitignore": "node_modules\n",
    "package.json": JSON.stringify({
      name: "t",
      version: "1.0.0",
      type: "module",
      main: "index.ts",
    }),
    "knip.json": JSON.stringify({ ignore: ["eslint.config.js"] }),
    "tsconfig.json":
      '{ "compilerOptions": { "strict": true, "target": "es2022", "module": "nodenext", "allowImportingTsExtensions": true, "noEmit": true } }',
    "eslint.config.js": CONFIG,
    "out/e.json": "[]\n",
    "out/t.json": "[]\n",
    ...one.files,
  });
  git(cwd, "init", "-q");
  git(cwd, "add", "-A");
  return cwd;
}

/** The secrets reader over every file this repository tracks, with its own `.secretlintrc.json`. */
function kitScript(): string {
  return [
    `const root = process.env.WT_KIT;`,
    `const { secretsReader } = await import(root + "/src/laws/readers/secrets.ts");`,
    `const { inputFor, lawOf } = await import(root + "/src/laws/readers/testkit.ts");`,
    `const { realExec } = await import(root + "/src/gate/exec.ts");`,
    `const { spawnSync } = await import("node:child_process");`,
    `const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).stdout.split("\\0").filter(Boolean);`,
    `const law = lawOf("W-39", [{ tool: "secretlint", name: "preset" }]);`,
    `const base = inputFor([law], { cwd: root, tracked });`,
    `const outDir = process.env.WT_OUT;`,
    `const readings = await secretsReader({ ...base, ctx: { ...base.ctx, outDir, exec: realExec } });`,
    `process.stdout.write(JSON.stringify({ tracked: tracked.length, readings: readings.map((one) => [one.law, one.verdict, one.findings.length]) }));`,
  ].join("\n");
}

/** The child's output, and the text of it, which must never hold the secret. */
function run(): { text: string; found: unknown } {
  const sent = SCENARIOS.map((one) => ({ name: one.name, law: one.law, cwd: project(one) }));
  const done = spawnSync("bun", ["-e", script()], {
    cwd: KIT,
    env: { ...process.env, WT_KIT: KIT, WT_SCENARIOS: JSON.stringify(sent) },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (done.status !== 0) {
    throw new Error(`the layer did not run: ${done.stderr}`);
  }
  const found: unknown = JSON.parse(done.stdout);
  return { text: done.stdout, found };
}

describe.skipIf(insideStryker)("G9 the real secretlint and knip, through the laws layer", () => {
  it(
    "refuses a planted secret and an unused export with their laws, and passes the clean twins",
    () => {
      const { text, found } = run();
      expect(found).toEqual({
        "W-39 planted": [
          ["law/W-39", "refuse", null, null],
          ["secretlint:@secretlint/secretlint-rule-aws", "refuse", "src/leak.ts", 2],
        ],
        "W-39 clean": [["law/W-39", "pass", null, null]],
        "W-39 allowed by the project's own config": [["law/W-39", "pass", null, null]],
        "W-48 planted": [
          ["law/W-48", "ack-missing", null, null],
          ["knip:files", "ack-missing", "unused.ts", null],
          ["knip:exports", "ack-missing", "utils.ts", 2],
        ],
        "W-48 planted, but ignored by the project's own knip config": [
          ["law/W-48", "pass", null, null],
        ],
        "W-48 clean": [["law/W-48", "pass", null, null]],
      });
      expect(text).not.toContain(FAKE);
    },
    SLOW,
  );

  it(
    "reads this repository's own tracked tree as clean, with the documented fakes its tests hold allowed by its config",
    () => {
      const done = spawnSync("bun", ["-e", kitScript()], {
        cwd: KIT,
        env: { ...process.env, WT_KIT: KIT, WT_OUT: tempDir() },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(done.status, done.stderr).toBe(0);
      const found: unknown = JSON.parse(done.stdout);
      expect(found).toMatchObject({ readings: [["W-39", "pass", 0]] });
      expect(Number(Reflect.get(Object(found), "tracked"))).toBeGreaterThan(500);
    },
    SLOW,
  );
});
