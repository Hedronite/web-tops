import { spawnSync } from "node:child_process";
import { rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../../init/test-support.ts";

/**
 * The real coverage layer (gate 3) counts the ack ledger: one `census/webtops-ack` for each entry, and a failing
 * `ack-ledger-unreadable` for a ledger that cannot be read, whether or not the laws layer is enabled. The layer runs in
 * a child process with the real process runner, so this proves what the layer is given and what it reports, not the
 * code of the layer, which the tests beside it judge; it is not run inside a Stryker worker.
 */

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const KIT = resolve(import.meta.dirname, "../../..");
const SLOW = 120_000;
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

const LEDGER = [
  "version: 1",
  "acks:",
  "  - law: W-12",
  "    file: src/a.ts",
  "    reason: Each step needs the one before it.",
  "    owner: web-platform",
  "  - law: W-13",
  "    file: src/b.ts",
  "    reason: The two must stay together.",
  "    owner: web-platform",
  "",
].join("\n");

const SCRIPT = [
  `const root = process.env.WT_KIT;`,
  `const { coverageLayer } = await import(root + "/src/layers/coverage/index.ts");`,
  `const { realExec } = await import(root + "/src/gate/exec.ts");`,
  `const { cfg } = await import(root + "/src/gate/testkit.ts");`,
  `const cwd = process.argv[1];`,
  `const config = cfg({ coverage: { linesFloor: 0, exclude: [] }, ...JSON.parse(process.env.WT_CONFIG) });`,
  `const result = await coverageLayer.run({`,
  `  cwd, config, base: "origin/main", enforce: "hard", env: { PATH: process.env.PATH ?? "" }, exec: realExec,`,
  `  outDir: cwd + "/.web-tops/out",`,
  `  artifacts: new Map([["lcov", cwd + "/.web-tops/out/lcov.info"], ["setup-files", cwd + "/.web-tops/out/setup-files.json"]]),`,
  `});`,
  `const found = result.findings.filter((one) => one.rule === "census/webtops-ack" || one.rule === "ack-ledger-unreadable")`,
  `  .map(({ rule, verdict, file }) => ({ rule, verdict, file }));`,
  `process.stdout.write(JSON.stringify(found));`,
].join("\n");

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (done.status !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
}

/** A tracked project with two source files, fully covered, and the ledger files given. */
function project(files: Readonly<Record<string, string>>): string {
  const cwd = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(cwd, "node_modules"));
  put(cwd, "package.json", '{ "type": "module" }\n');
  put(cwd, "src/a.ts", "export const a = 1;\n");
  put(cwd, "src/b.ts", "export const b = 1;\n");
  put(
    cwd,
    ".web-tops/out/lcov.info",
    ["a", "b"]
      .map((name) => `TN:\nSF:src/${name}.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n`)
      .join(""),
  );
  put(cwd, ".web-tops/out/setup-files.json", "[]");
  for (const [file, text] of Object.entries(files)) put(cwd, file, text);
  git(cwd, "init", "-q");
  git(cwd, "add", "-A", "-f", "package.json", "src");
  return cwd;
}

function found(cwd: string, config: Readonly<Record<string, unknown>> = {}): unknown {
  const done = spawnSync("bun", ["-e", SCRIPT, cwd], {
    cwd,
    env: { ...process.env, WT_KIT: KIT, WT_CONFIG: JSON.stringify(config) },
    encoding: "utf8",
  });
  expect(done.status, done.stderr).toBe(0);
  return JSON.parse(done.stdout);
}

const LAWS_OFF = { toggles: { laws: { enabled: false, reason: "not yet" } } };

describe.skipIf(insideStryker)("the coverage layer counts the ack ledger", () => {
  it(
    "counts one webtops-ack for each entry of the default ledger, with the laws layer off too",
    () => {
      const cwd = project({ ".web-tops/acks.yaml": LEDGER });
      for (const config of [{}, LAWS_OFF]) {
        expect(found(cwd, config)).toEqual([
          { rule: "census/webtops-ack", verdict: "pass", file: "src/a.ts" },
          { rule: "census/webtops-ack", verdict: "pass", file: "src/b.ts" },
        ]);
      }
    },
    SLOW,
  );

  it(
    "reads the ledger the config names, and not the default one",
    () => {
      const cwd = project({
        "docs/acks.yaml": LEDGER,
        ".web-tops/acks.yaml": "version: 1\nacks: []\n",
      });
      expect(found(cwd, { ackLedger: "docs/acks.yaml" })).toHaveLength(2);
      expect(found(cwd)).toEqual([]);
    },
    SLOW,
  );

  it(
    "fails a ledger that cannot be read, naming it",
    () => {
      const cwd = project({ ".web-tops/acks.yaml": "version: 1\nacks:\n  - law: W-12\n" });
      expect(found(cwd, LAWS_OFF)).toEqual([
        { rule: "ack-ledger-unreadable", verdict: "fail", file: ".web-tops/acks.yaml" },
      ]);
    },
    SLOW,
  );
});
