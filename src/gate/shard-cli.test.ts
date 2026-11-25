import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "./test-support-timeouts.ts";

const root = resolve(import.meta.dirname, "../..");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function put(dir: string, file: string, text: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
}

function git(dir: string, args: readonly string[]): void {
  execFileSync("git", [...args], { cwd: dir, stdio: "ignore" });
}

function initRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-shard-cli-"));
  dirs.push(dir);
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  put(dir, ".gitignore", "node_modules\n.web-tops\n");
  put(dir, "package.json", JSON.stringify({ name: "shard-probe", private: true, type: "module" }));
  put(
    dir,
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        types: [],
      },
      include: ["src"],
    }),
  );
  put(
    dir,
    "web-tops.yaml",
    [
      'protocol: "0.3.0"',
      'version: "0.1.0"',
      "package: shard-probe",
      "class: ts-library",
      "enforce: ratchet",
      "baseline: .web-tops/baseline.json",
      "gates:",
      '  hygiene: { enabled: false, reason: "tested separately" }',
      "  coverage: { lines_floor: 85 }",
      "  crap: { cap: 4 }",
      "  mutation: { scope: diff, unexplained_survivors_max: 0, time_budget_minutes: 10 }",
      "layers:",
      '  size_limit: { enabled: false, reason: "tested separately" }',
      '  package_exports: { enabled: false, reason: "not published" }',
      'laws: { enabled: false, reason: "tested separately" }',
    ].join("\n") + "\n",
  );
  git(dir, ["init", "-q", "-b", "main"]);
  put(dir, "README.md", "base\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "base"]);
  git(dir, ["branch", "origin/main"]);
  for (const [file, text] of Object.entries(files)) put(dir, file, text);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "head"]);
  return dir;
}

const field = (value: unknown, key: string): unknown => Reflect.get(Object(value), key);

const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

describe.skipIf(insideStryker)("webtops gate --shard i/n CLI end-to-end", () => {
  it("exits 2 on malformed or out-of-range --shard and 0 on --dry-run", () => {
    for (const bad of ["0/2", "3/2", "1/5", "bad"]) {
      const res = spawnSync("bun", [join(root, "src/cli/main.ts"), "gate", "--shard", bad], {
        cwd: root,
        encoding: "utf8",
      });
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("--shard");
    }
    const env = { ...process.env };
    delete env["CI"];
    const dry = spawnSync(
      "bun",
      [join(root, "src/cli/main.ts"), "gate", "--shard", "1/2", "--dry-run"],
      { cwd: root, encoding: "utf8", env },
    );
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("would run");
  });

  it(
    "runs B1 shards with partial.json, identical entriesHash, disjoint entries, and no survivor failure",
    () => {
      const dir = initRepo({
        "src/alpha.ts": "export function alpha(n: number): number { return n + 1; }\n",
        "src/beta.ts": "export function beta(n: number): number { return n + 2; }\n",
        "src/both.test.ts":
          [
            'import { expect, it } from "vitest";',
            'import { alpha } from "./alpha.ts";',
            'import { beta } from "./beta.ts";',
            'it("covers both without asserting beta", () => { expect(alpha(1)).toBe(2); beta(1); });',
          ].join("\n") + "\n",
      });

      const s1 = spawnSync(
        "bun",
        [join(root, "src/cli/main.ts"), "gate", "--max-tier", "1", "--shard", "1/2"],
        { cwd: dir, encoding: "utf8" },
      );
      expect(s1.status, s1.stderr + s1.stdout).toBe(0);
      const p1: unknown = JSON.parse(
        readFileSync(join(dir, ".web-tops/out/mutation/partial.json"), "utf8"),
      );

      const s2 = spawnSync(
        "bun",
        [join(root, "src/cli/main.ts"), "gate", "--max-tier", "1", "--shard", "2/2"],
        { cwd: dir, encoding: "utf8" },
      );
      expect(s2.status, s2.stderr + s2.stdout).toBe(0);
      const p2: unknown = JSON.parse(
        readFileSync(join(dir, ".web-tops/out/mutation/partial.json"), "utf8"),
      );

      expect(field(p1, "shard")).toBe(1);
      expect(field(p2, "shard")).toBe(2);
      expect(field(p1, "shards")).toBe(2);
      expect(field(p2, "shards")).toBe(2);
      expect(field(p1, "base")).toBe(field(p2, "base"));
      expect(field(p1, "entriesHash")).toBe(field(p2, "entriesHash"));
      const e1 = field(p1, "shardEntries");
      const e2 = field(p2, "shardEntries");
      expect(Array.isArray(e1) && Array.isArray(e2)).toBe(true);
      expect(e1).not.toEqual(e2);
      const surv1 = field(p1, "survivors");
      const surv2 = field(p2, "survivors");
      const totalSurvivors =
        (Array.isArray(surv1) ? surv1.length : 0) + (Array.isArray(surv2) ? surv2.length : 0);
      expect(totalSurvivors).toBeGreaterThan(0);
      expect(existsSync(join(dir, ".web-tops/survivors.yaml"))).toBe(false);
      expect(existsSync(join(dir, ".web-tops/baseline.json"))).toBe(false);
    },
    REAL_TOOL_TIMEOUT * 4,
  );

  it(
    "writes vacuous partial.json with entriesHash on a docs-only diff",
    () => {
      const dir = initRepo({
        "src/alpha.ts": "export function alpha(n: number): number { return n + 1; }\n",
        "src/alpha.test.ts":
          'import { expect, it } from "vitest";\nimport { alpha } from "./alpha.ts";\nit("ok", () => { expect(alpha(1)).toBe(2); });\n',
      });
      git(dir, ["branch", "-f", "origin/main", "HEAD"]);
      put(dir, "README.md", "docs update\n");
      git(dir, ["add", "README.md"]);
      git(dir, [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "commit",
        "-q",
        "-m",
        "docs",
      ]);

      const res = spawnSync(
        "bun",
        [join(root, "src/cli/main.ts"), "gate", "--max-tier", "1", "--shard", "1/2"],
        { cwd: dir, encoding: "utf8" },
      );
      expect(res.status, res.stderr + res.stdout).toBe(0);
      const partial: unknown = JSON.parse(
        readFileSync(join(dir, ".web-tops/out/mutation/partial.json"), "utf8"),
      );
      expect(partial).toMatchObject({
        shard: 1,
        shards: 2,
        entriesCount: 0,
        shardEntries: [],
        vacuous: true,
        timedOut: false,
        starved: false,
      });
      expect(String(field(partial, "entriesHash"))).toMatch(/^[0-9a-f]{64}$/u);
    },
    REAL_TOOL_TIMEOUT * 2,
  );
});
