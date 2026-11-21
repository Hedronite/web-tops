import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { recorded } from "../../layers/hygiene/testkit.ts";
import { cleanTemp, tempDir } from "../probe/testkit.ts";

/**
 * G9: the gate-1 artifact readers, registered in the laws layer, judge the real catalog's laws. The real layer runs in
 * a child process over a project with the project's own ESLint, so this covers the registry and the process boundary,
 * not the readers' code, which the tests beside them judge; it is not run inside a Stryker worker.
 */

afterAll(cleanTemp);

const KIT = resolve(import.meta.dirname, "../../..");
const SLOW = 120_000;
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

const CONFIG = [
  'import tseslint from "typescript-eslint";',
  "export default tseslint.config(",
  '  { files: ["**/*.ts"], extends: [tseslint.configs.strictTypeChecked], languageOptions: { parserOptions: { projectService: true } } },',
  ");",
  "",
].join("\n");

const cruise = (violating: boolean, rule: string): string =>
  JSON.stringify({
    summary: {
      violations: violating
        ? [
            {
              type: "cycle",
              from: "src/a.ts",
              to: "src/b.ts",
              rule: { name: rule, severity: "error" },
            },
          ]
        : [],
      ruleSetUsed: { forbidden: [{ name: rule, severity: "error" }] },
    },
  });

const ATTW_BAD = '{"code":1,"problems":[{"kind":"NoResolution","entrypoint":"."}]}';
const ATTW_OK = '{"code":0,"problems":[]}';
const PUBLINT_BAD = '{"code":1,"errors":["a missing file"]}';
const PUBLINT_OK = '{"code":0,"errors":[]}';
const FROZEN = (code: number): string =>
  JSON.stringify({ command: "bun install --frozen-lockfile", code });

interface Scenario {
  readonly name: string;
  readonly laws: readonly string[];
  /** What the layer says of the law. */
  readonly verdict: "pass" | "refuse" | "not-evaluated";
  /** The artifacts gate 1 kept, by name; one the tool did not write is absent. */
  readonly kept: Readonly<Record<string, string>>;
}

const FIXED: readonly Scenario[] = [
  {
    name: "W-16 planted",
    verdict: "refuse",
    laws: ["W-16"],
    kept: { "dependency-cruiser-json": cruise(true, "no-circular") },
  },
  {
    name: "W-16 clean",
    verdict: "pass",
    laws: ["W-16"],
    kept: { "dependency-cruiser-json": cruise(false, "no-circular") },
  },
  { name: "W-16 not run", verdict: "not-evaluated", laws: ["W-16"], kept: {} },
  {
    name: "W-38 planted",
    verdict: "refuse",
    laws: ["W-38"],
    kept: { "audit-json": recorded("audit-vulnerable.json") },
  },
  {
    name: "W-38 clean",
    verdict: "pass",
    laws: ["W-38"],
    kept: { "audit-json": recorded("audit-clean.json") },
  },
  { name: "W-40 planted", verdict: "refuse", laws: ["W-40"], kept: { "install-json": FROZEN(1) } },
  { name: "W-40 clean", verdict: "pass", laws: ["W-40"], kept: { "install-json": FROZEN(0) } },
  {
    name: "W-18 attw clean, publint not run",
    verdict: "not-evaluated",
    laws: ["W-18"],
    kept: { "attw-json": ATTW_OK },
  },
  {
    name: "W-18 attw planted, publint not run",
    verdict: "refuse",
    laws: ["W-18"],
    kept: { "attw-json": ATTW_BAD },
  },
  {
    name: "W-18 publint planted, attw clean",
    verdict: "refuse",
    laws: ["W-18"],
    kept: { "attw-json": ATTW_OK, "publint-json": PUBLINT_BAD },
  },
  {
    name: "W-18 both clean",
    verdict: "pass",
    laws: ["W-18"],
    kept: { "attw-json": ATTW_OK, "publint-json": PUBLINT_OK },
  },
];

/** The output of the real dependency-cruiser, with the kit's preset, over a package that declares `react` as an optional peer. */
function realCruise(file: string): string {
  const cwd = tempDir();
  put(cwd, {
    "package.json": JSON.stringify({
      name: "probe",
      type: "module",
      peerDependencies: { react: "*" },
      peerDependenciesMeta: { react: { optional: true } },
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { module: "preserve", moduleResolution: "bundler", noEmit: true },
      include: ["src"],
    }),
    "node_modules/react/package.json": JSON.stringify({ name: "react", main: "index.js" }),
    "node_modules/react/index.js": "module.exports = {};\n",
    [file]: 'import * as peer from "react";\nexport const value = peer;\n',
  });
  symlinkSync(join(KIT, "node_modules", "typescript"), join(cwd, "node_modules", "typescript"));
  const bin = join(KIT, "node_modules", ".bin", "depcruise");
  const config = join(KIT, "src", "presets", "depcruise.cjs");
  const done = spawnSync(bin, ["--config", config, "--output-type", "json", "src"], {
    cwd,
    encoding: "utf8",
  });
  return done.stdout;
}

/** W-19 over the real tool's output: its preset rule catches an optional peer imported outside a react entry or an adapter. */
const real = (): readonly Scenario[] => [
  {
    name: "W-19 planted, real depcruise output",
    verdict: "refuse",
    laws: ["W-19"],
    kept: { "dependency-cruiser-json": realCruise("src/index.ts") },
  },
  {
    name: "W-19 clean, real depcruise output",
    verdict: "pass",
    laws: ["W-19"],
    kept: { "dependency-cruiser-json": realCruise("src/react/index.ts") },
  },
];

const scenarios = (): readonly Scenario[] => [...FIXED, ...real()];

function script(): string {
  return [
    `const root = process.env.WT_KIT;`,
    `const { realExec } = await import(root + "/src/gate/exec.ts");`,
    `const { lawsLayer } = await import(root + "/src/laws/layer/index.ts");`,
    `const { yamlCatalog } = await import(root + "/src/laws/layer/catalog.ts");`,
    `const { cfg } = await import(root + "/src/gate/testkit.ts");`,
    `const cwd = process.argv[1];`,
    `const scenarios = JSON.parse(process.env.WT_SCENARIOS);`,
    `const out = {};`,
    `for (const one of scenarios) {`,
    `  const laws = yamlCatalog().filter((law) => one.laws.includes(law.id));`,
    `  const artifacts = new Map([["eslint-json", cwd + "/out/e.json"], ["tsc-diagnostics", cwd + "/out/t.json"]]);`,
    `  for (const name of one.kept) artifacts.set(name, cwd + "/out/" + one.name + "/" + name);`,
    `  const result = await lawsLayer(() => laws).run({`,
    `    cwd, config: cfg({ class: "ts-library" }), base: "origin/main", enforce: "hard",`,
    `    env: { PATH: process.env.PATH ?? "" }, exec: realExec, outDir: cwd + "/.web-tops/out",`,
    `    artifacts,`,
    `  });`,
    `  out[one.name] = result.findings.filter((found) => found.rule.startsWith("law/")).map((found) => [found.rule, found.verdict]);`,
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

/** A project that commits `bun.lock`, with the artifacts of each scenario written where the child reads them. */
function project(all: readonly Scenario[]): string {
  const cwd = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(cwd, "node_modules"));
  put(cwd, {
    "package.json": '{ "type": "module" }\n',
    "tsconfig.json":
      '{ "compilerOptions": { "strict": true, "target": "es2022", "module": "nodenext" }, "include": ["src"] }',
    "src/a.ts": "export const a: number = 1;\n",
    "eslint.config.js": CONFIG,
    "bun.lock": "{}\n",
    "out/e.json": "[]\n",
    "out/t.json": "[]\n",
  });
  for (const one of all) {
    put(
      cwd,
      Object.fromEntries(
        Object.entries(one.kept).map(([name, text]) => [`out/${one.name}/${name}`, text]),
      ),
    );
  }
  git(cwd, "init", "-q");
  git(cwd, "add", "-A");
  return cwd;
}

function verdicts(all: readonly Scenario[]): unknown {
  const cwd = project(all);
  const sent = all.map((one) => ({ name: one.name, laws: one.laws, kept: Object.keys(one.kept) }));
  const done = spawnSync("bun", ["-e", script(), cwd], {
    cwd,
    env: { ...process.env, WT_KIT: KIT, WT_SCENARIOS: JSON.stringify(sent) },
    encoding: "utf8",
  });
  if (done.status !== 0) {
    throw new Error(`the layer did not run: ${done.stderr}`);
  }
  const parsed: unknown = JSON.parse(done.stdout);
  return parsed;
}

describe.skipIf(insideStryker)(
  "G9 the registered readers judge the catalog's laws through the laws layer",
  () => {
    it(
      "refuses each planted violation with its law, passes its clean twin, and is not evaluated when the tool did not run",
      () => {
        const all = scenarios();
        const expected = all.map((one) => [one.name, [[`law/${one.laws.join("")}`, one.verdict]]]);
        expect(verdicts(all)).toEqual(Object.fromEntries(expected));
      },
      SLOW,
    );
  },
);
