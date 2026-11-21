import { spawnSync } from "node:child_process";
import { rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../../init/test-support.ts";

/**
 * The gate runner on a real project, with the real laws layer, the real catalog and the project's own ESLint, and the
 * laws layer enabled: the ledger turns the refusal of a soft law (W-12, whose rule `no-await-in-loop` the project's
 * ESLint config leaves off, so the place the refusal names is that config) into a pass that carries the ack, a hard law's
 * acknowledgement (W-04) and one of an id that is no law (W-99) each fail the run, in a comment and in the ledger. The
 * run is in a child process, so this covers the process boundary, the tools and the catalog, not the code of the layer,
 * which the tests beside it judge; it is not run inside a Stryker worker.
 */

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const KIT = resolve(import.meta.dirname, "../../..");
const SLOW = 120_000;
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

const CONFIG = [
  'import tseslint from "typescript-eslint";',
  "export default tseslint.config(",
  '  { files: ["**/*.ts"], languageOptions: { parserOptions: { projectService: true } } },',
  ");",
  "",
].join("\n");

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "es2022", module: "nodenext", strict: true },
  include: ["src"],
});

const entry = (law: string, file: string): string =>
  `  - law: ${law}\n    file: ${file}\n    reason: Each step needs the one before it.\n    owner: web-platform\n`;

const ledger = (...entries: string[]): string => `version: 1\nacks:\n${entries.join("")}`;

/** The script: runGate over a hygiene layer that wrote the two artifacts the laws layer reads, and the real laws layer. */
const SCRIPT = [
  `const root = process.env.WT_KIT;`,
  `const { runGate } = await import(root + "/src/gate/runner.ts");`,
  `const { lawsLayer } = await import(root + "/src/laws/layer/index.ts");`,
  `const { yamlCatalog } = await import(root + "/src/laws/layer/catalog.ts");`,
  `const { realExec } = await import(root + "/src/gate/exec.ts");`,
  `const { cfg, fakeLayer, opts } = await import(root + "/src/gate/testkit.ts");`,
  `const cwd = process.argv[1];`,
  `const laws = yamlCatalog().filter((law) => ["W-04", "W-12"].includes(law.id)).map((law) => ({ ...law, judged: law.id === "W-12" }));`,
  `const hygiene = fakeLayer({ id: "hygiene", gate: 1, artifacts: { "eslint-json": cwd + "/.web-tops/out/hygiene/e.json", "tsc-diagnostics": cwd + "/.web-tops/out/hygiene/t.json" } });`,
  `const report = await runGate({`,
  `  layers: [hygiene, lawsLayer(() => laws)], config: cfg({ class: "ts-library" }), options: opts(),`,
  `  cwd, env: { PATH: process.env.PATH ?? "" }, exec: realExec, outDir: cwd + "/.web-tops/out", now: Date.now,`,
  `});`,
  `const layer = report.layers.find((one) => one.id === "laws");`,
  `const found = (layer?.findings ?? []).filter((one) => one.rule.startsWith("ack-") || one.rule === "no-await-in-loop")`,
  `  .map(({ rule, verdict, file, line, ack }) => ({ rule, verdict, file, line, ack }));`,
  `process.stdout.write(JSON.stringify({ verdict: layer?.verdict, found }));`,
].join("\n");

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (done.status !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
}

/** A tracked project whose ESLint config leaves `no-await-in-loop` off, with the files given. */
function project(files: Readonly<Record<string, string>> = {}): string {
  const cwd = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(cwd, "node_modules"));
  put(cwd, "package.json", '{ "type": "module" }\n');
  put(cwd, "tsconfig.json", TSCONFIG);
  put(cwd, "src/a.ts", "export const a: number = 1;\n");
  put(cwd, "eslint.config.js", CONFIG);
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

const SOFT = ledger(entry("W-12", "eslint.config.js"));

describe.skipIf(insideStryker)(
  "the gate on a real project, the laws layer enabled: acknowledgements",
  () => {
    it(
      "leaves a soft law's refusal ack-missing with no entry, and passes it with the ledger's ack with one",
      () => {
        const open = gateOn(project());
        expect(open.verdict).toBe("ack-missing");
        const acked = gateOn(project({ ".web-tops/acks.yaml": SOFT }));
        expect(acked.verdict).toBe("pass");
        expect(acked.found).toMatchObject([
          {
            rule: "no-await-in-loop",
            verdict: "pass",
            file: "eslint.config.js",
            ack: { source: "ledger", reason: "Each step needs the one before it." },
          },
        ]);
      },
      SLOW,
    );

    it(
      "fails a comment of a hard law and one of an id that is no law, at the comment's line",
      () => {
        const text = [
          "export const a: number = 1;",
          "// webtops-ack W-04: Reviewed with the owner.",
          "// webtops-ack W-99: Reviewed with the owner.",
          "",
        ].join("\n");
        const done = gateOn(project({ "src/a.ts": text }));
        expect(done.verdict).toBe("fail");
        expect(done.found).toMatchObject([
          { rule: "no-await-in-loop", verdict: "ack-missing" },
          { rule: "ack-not-needed", verdict: "fail", file: "src/a.ts", line: 2 },
          { rule: "ack-unknown-law", verdict: "fail", file: "src/a.ts", line: 3 },
        ]);
      },
      SLOW,
    );

    it(
      "fails a ledger entry of a hard law and one of an id that is no law, at the ledger",
      () => {
        const done = gateOn(
          project({
            ".web-tops/acks.yaml": ledger(
              entry("W-04", "src/a.ts"),
              entry("W-99", "src/a.ts"),
              entry("W-12", "eslint.config.js"),
            ),
          }),
        );
        expect(done.verdict).toBe("fail");
        expect(done.found).toMatchObject([
          { rule: "no-await-in-loop", verdict: "pass", ack: { source: "ledger" } },
          { rule: "ack-not-needed", verdict: "fail", file: ".web-tops/acks.yaml" },
          { rule: "ack-unknown-law", verdict: "fail", file: ".web-tops/acks.yaml" },
        ]);
      },
      SLOW,
    );
  },
);
