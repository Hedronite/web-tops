import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function put(dir: string, file: string, text: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
}

function repo(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-join-cli-"));
  dirs.push(dir);
  put(dir, "web-tops.yaml", yaml);
  return dir;
}

const HEAD =
  [
    'protocol: "0.3.0"',
    'version: "0.1.0"',
    "package: pkg",
    "class: ts-library",
    "enforce: hard",
  ].join("\n") + "\n";

function writePartialFile(dir: string, shard: number, over: Record<string, unknown> = {}): void {
  const payload = {
    version: 1,
    shard,
    shards: 2,
    base: "abc123",
    entriesHash: "deadbeef",
    entriesCount: 2,
    shardEntries: [`src/f${String(shard)}.ts:1-5`],
    counts: {
      killed: 3,
      timeout: 0,
      survived: 0,
      no_coverage: 0,
      runtime_error: 0,
      compile_error: 0,
      ignored: 0,
    },
    survivors: [],
    excluded: 0,
    unknown: [],
    timedOut: false,
    starved: false,
    vacuous: false,
    ...over,
  };
  put(dir, "partial.json", JSON.stringify(payload));
}

const SURV_KEY = {
  file: "src/f2.ts",
  function: "src/f2.ts::fn",
  mutator: "ArithmeticOperator",
  original: "+",
  replacement: "-",
  occurrence: 1,
};

const LEDGER_YAML =
  [
    "version: 1",
    "survivors:",
    "  - file: src/f2.ts",
    "    function: src/f2.ts::fn",
    "    mutator: ArithmeticOperator",
    '    original: "+"',
    '    replacement: "-"',
    "    occurrence: 1",
    "    reason: equivalent",
    "    owner: qa",
  ].join("\n") + "\n";

const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

describe.skipIf(insideStryker)("webtops gate --join <dir> CLI end-to-end", () => {
  it("unifies partials under .web-tops/out/shards, writes report, and runs ledger once", () => {
    const dir = repo(HEAD);
    const shardsDir = join(dir, ".web-tops", "out", "shards");
    writePartialFile(join(shardsDir, "s1"), 1);
    writePartialFile(join(shardsDir, "s2"), 2, {
      counts: {
        killed: 3,
        timeout: 0,
        survived: 1,
        no_coverage: 0,
        runtime_error: 0,
        compile_error: 0,
        ignored: 0,
      },
      survivors: [{ status: "Survived", file: "src/f2.ts", line: 2, key: SURV_KEY }],
    });

    const failRun = spawnSync(
      "bun",
      [join(root, "src/cli/main.ts"), "gate", "--join", shardsDir, "--json"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(failRun.status).toBe(1);
    const reportJson: unknown = JSON.parse(failRun.stdout);
    expect(reportJson).toMatchObject({ passed: false, exit_code: 1, enforced: true });
    expect(readFileSync(join(dir, ".web-tops/report.json"), "utf8")).toContain(
      "ArithmeticOperator",
    );

    put(dir, ".web-tops/survivors.yaml", LEDGER_YAML);
    const passRun = spawnSync(
      "bun",
      [join(root, "src/cli/main.ts"), "gate", "--join", ".web-tops/out/shards"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(passRun.status, passRun.stderr + passRun.stdout).toBe(0);
    expect(passRun.stdout).toContain("gate passed");
  });

  it("fails closed on missing shard, propagates timeout not-evaluated, and refuses --join + --shard with exit 2", () => {
    const dir = repo(HEAD);
    writePartialFile(join(dir, "shards", "s1"), 1);
    const missing = spawnSync("bun", [join(root, "src/cli/main.ts"), "gate", "--join", "shards"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain("missing shard 2/2");

    writePartialFile(join(dir, "shards", "s2"), 2, { timedOut: true });
    const timed = spawnSync("bun", [join(root, "src/cli/main.ts"), "gate", "--join", "shards"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(timed.status).toBe(1);
    expect(timed.stdout).toContain("not-evaluated");

    const bad = spawnSync(
      "bun",
      [join(root, "src/cli/main.ts"), "gate", "--join", "shards", "--shard", "1/2"],
      { cwd: dir, encoding: "utf8" },
    );
    expect(bad.status).toBe(2);
  });
});
