import { spawnSync } from "node:child_process";
import { rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../../init/test-support.ts";

/**
 * The gate runner on a real project, with the real laws layer, the real catalog and the project's own ESLint, laws
 * enabled: a rule an override lowers for one file (W-12, `no-await-in-loop`) is a refusal at that config line, and an
 * acknowledgement of that line, in the ledger or as a comment, passes the line. It passes the law only when gate 1's
 * ESLint run found no error of the rule: such an error is part of the refusal, at no config line, and no
 * acknowledgement covers it. The run is in a child process, so this covers the process boundary, the tools and the
 * catalog, not the code of the layer, which the tests beside it judge; it is not run inside a Stryker worker.
 */

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const KIT = resolve(import.meta.dirname, "../../..");
const SLOW = 120_000;
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

const RULE = '"no-await-in-loop"';

const config = (note: string): string =>
  [
    'import tseslint from "typescript-eslint";',
    "export default tseslint.config(",
    `  { files: ["**/*.ts"], languageOptions: { parserOptions: { projectService: true } }, rules: { ${RULE}: "error" } },`,
    ...(note === "" ? [] : [note]),
    `  { files: ["src/legacy.ts"], rules: { ${RULE}: "off" } },`,
    ");",
    "",
  ].join("\n");

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "es2022", module: "nodenext", strict: true },
  include: ["src"],
});

/** What gate 1's ESLint run wrote: one error of the rule in `src/a.ts`, or nothing. */
const ERROR = JSON.stringify([
  {
    filePath: "src/a.ts",
    messages: [{ ruleId: "no-await-in-loop", severity: 2, message: "x", line: 1, column: 1 }],
    errorCount: 1,
    warningCount: 0,
  },
]);

const LEDGER =
  "version: 1\nacks:\n  - law: W-12\n    file: eslint.config.js\n    reason: The legacy file awaits in order.\n    owner: web-platform\n";

const SCRIPT = [
  `const root = process.env.WT_KIT;`,
  `const { runGate } = await import(root + "/src/gate/runner.ts");`,
  `const { lawsLayer } = await import(root + "/src/laws/layer/index.ts");`,
  `const { yamlCatalog } = await import(root + "/src/laws/layer/catalog.ts");`,
  `const { realExec } = await import(root + "/src/gate/exec.ts");`,
  `const { cfg, fakeLayer, opts } = await import(root + "/src/gate/testkit.ts");`,
  `const cwd = process.argv[1];`,
  `const laws = yamlCatalog().filter((law) => law.id === "W-12").map((law) => ({ ...law, judged: true }));`,
  `const hygiene = fakeLayer({ id: "hygiene", gate: 1, artifacts: { "eslint-json": cwd + "/.web-tops/out/hygiene/e.json", "tsc-diagnostics": cwd + "/.web-tops/out/hygiene/t.json" } });`,
  `const report = await runGate({`,
  `  layers: [hygiene, lawsLayer(() => laws)], config: cfg({ class: "ts-library" }), options: opts(),`,
  `  cwd, env: { PATH: process.env.PATH ?? "" }, exec: realExec, outDir: cwd + "/.web-tops/out", now: Date.now,`,
  `});`,
  `const layer = report.layers.find((one) => one.id === "laws");`,
  `const found = (layer?.findings ?? []).filter((one) => one.rule === "no-await-in-loop")`,
  `  .map(({ rule, verdict, file, line, ack }) => ({ rule, verdict, file, line, ack }));`,
  `process.stdout.write(JSON.stringify({ verdict: layer?.verdict, found }));`,
].join("\n");

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (done.status !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
}

/** A tracked project whose config lowers the rule for `src/legacy.ts`, with the files given beside it. */
function project(files: Readonly<Record<string, string>>, note = ""): string {
  const cwd = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(cwd, "node_modules"));
  put(cwd, "package.json", '{ "type": "module" }\n');
  put(cwd, "tsconfig.json", TSCONFIG);
  put(cwd, "src/a.ts", "export const a: number = 1;\n");
  put(cwd, "src/legacy.ts", "export const b: number = 2;\n");
  put(cwd, "eslint.config.js", config(note));
  put(cwd, ".web-tops/out/hygiene/e.json", "[]\n");
  put(cwd, ".web-tops/out/hygiene/t.json", "[]\n");
  for (const [file, text] of Object.entries(files)) put(cwd, file, text);
  git(cwd, "init", "-q");
  git(cwd, "add", "-A", "-f");
  return cwd;
}

function gateOn(cwd: string): { verdict: unknown; found: unknown } {
  const done = spawnSync("bun", ["-e", SCRIPT, cwd], {
    cwd,
    env: { ...process.env, WT_KIT: KIT },
    encoding: "utf8",
  });
  expect(done.status, done.stderr).toBe(0);
  const parsed: unknown = JSON.parse(done.stdout);
  return {
    verdict: Reflect.get(Object(parsed), "verdict"),
    found: Reflect.get(Object(parsed), "found"),
  };
}

const COMMENT = "  // webtops-ack W-12: The legacy file awaits in order.";

describe.skipIf(insideStryker)(
  "the gate on a real project, laws enabled: an acknowledged config line and an open error of the rule",
  () => {
    it(
      "passes the law when the ledger acknowledges the lowered line and gate 1 found no error of the rule",
      () => {
        const done = gateOn(project({ ".web-tops/acks.yaml": LEDGER }));
        expect(done.verdict).toBe("pass");
        expect(done.found).toMatchObject([
          { verdict: "pass", file: "eslint.config.js", ack: { source: "ledger" } },
        ]);
      },
      SLOW,
    );

    it(
      "keeps the law open when the ledger acknowledges the line and gate 1 found an error of the rule",
      () => {
        const done = gateOn(
          project({ ".web-tops/acks.yaml": LEDGER, ".web-tops/out/hygiene/e.json": ERROR }),
        );
        expect(done.verdict).toBe("ack-missing");
        expect(done.found).toMatchObject([
          { verdict: "pass", file: "eslint.config.js", ack: { source: "ledger" } },
          { verdict: "ack-missing", file: null },
        ]);
      },
      SLOW,
    );

    it(
      "keeps the law open when a comment acknowledges the line and gate 1 found an error of the rule",
      () => {
        const open = gateOn(project({ ".web-tops/out/hygiene/e.json": ERROR }, COMMENT));
        expect(open.verdict).toBe("ack-missing");
        expect(open.found).toMatchObject([
          { verdict: "pass", file: "eslint.config.js", ack: { source: "comment" } },
          { verdict: "ack-missing", file: null },
        ]);
        const quiet = gateOn(project({}, COMMENT));
        expect(quiet.verdict).toBe("pass");
      },
      SLOW,
    );
  },
);
