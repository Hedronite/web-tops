import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateReport } from "../config/report.ts";
import { runGateCli } from "./gate.ts";
import type { Io } from "./io.ts";

const root = resolve(import.meta.dirname, "../..");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const HEAD = 'protocol: "0.2.1"\nversion: "0.1.0"\npackage: pkg\nclass: ts-library\n';
const HARD = `${HEAD}enforce: hard\n`;
const ADVISORY = `${HEAD}enforce: advisory\nexemption: { until: "2099-12-31", reason: "the gate runs on a bare project" }\n`;

function project(yaml: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-gate-cli-"));
  dirs.push(dir);
  if (yaml !== undefined) {
    writeFileSync(join(dir, "web-tops.yaml"), yaml);
  }
  return dir;
}

function run(dir: string, argv: string[], env: Record<string, string | undefined> = {}) {
  let out = "";
  let err = "";
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: dir,
    env,
  };
  return runGateCli(argv, io).then((code) => ({ code, out, err }));
}

describe("webtops gate, through runGateCli and G1's config", () => {
  it("fails a hard gate on a bare project and writes a report the schema accepts", async () => {
    const dir = project(HARD);
    const result = await run(dir, []);
    expect(result.code).toBe(1);
    expect(result.out).toContain("gate failed (exit 1)");
    const path = join(dir, ".web-tops", "report.json");
    expect(existsSync(path)).toBe(true);
    const validated = validateReport(JSON.parse(readFileSync(path, "utf8")));
    expect(validated).toMatchObject({ ok: true });
    if (validated.ok) {
      expect(validated.value.layers.map((layer) => layer.id)).toEqual([
        "hygiene",
        "tests",
        "coverage",
        "crap",
        "mutation",
        "build-output",
        "laws",
      ]);
      expect(validated.value.enforced).toBe(true);
      expect(validated.value.exit_code).toBe(1);
    }
  });

  it("reports an advisory run as not enforced and exits 0, with a valid report", async () => {
    const dir = project(ADVISORY);
    const result = await run(dir, ["--json"]);
    expect(result.code).toBe(0);
    const printed: unknown = JSON.parse(result.out);
    const validated = validateReport(printed);
    expect(validated).toMatchObject({ ok: true });
    if (validated.ok) {
      expect(validated.value).toMatchObject({ enforced: false, passed: false, exit_code: 0 });
    }
  });

  it("writes the report where report.path says", async () => {
    const dir = project(`${ADVISORY}report: { path: out/gate.json }\n`);
    await run(dir, []);
    expect(existsSync(join(dir, "out", "gate.json"))).toBe(true);
  });

  it("exits 2 for an invalid config, naming the JSON pointer, and leaves no report", async () => {
    const dir = project(`${HEAD}enforce: hard\ngates:\n  crap: { cap: 0 }\n`);
    const result = await run(dir, []);
    expect(result.code).toBe(2);
    expect(result.err).toContain("/gates/crap/cap");
    expect(existsSync(join(dir, ".web-tops", "report.json"))).toBe(false);
  });

  it("exits 2 for a semantic failure: ratchet needs a baseline that M1 cannot write", async () => {
    const dir = project(`${HEAD}enforce: ratchet\n`);
    const result = await run(dir, []);
    expect(result.code).toBe(2);
    expect(result.err).toContain("/baseline");
  });

  it("exits 2 when there is no web-tops.yaml", async () => {
    const result = await run(project(undefined), []);
    expect(result.code).toBe(2);
    expect(result.err).toContain("web-tops.yaml");
  });

  it("refuses --dry-run under CI=true with exit 4, before it reads the config", async () => {
    const result = await run(project(undefined), ["--dry-run"], { CI: "true" });
    expect(result.code).toBe(4);
  });

  it("prints a plan for --dry-run outside CI and writes nothing", async () => {
    const dir = project(HARD);
    const result = await run(dir, ["--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("would run");
    expect(existsSync(join(dir, ".web-tops"))).toBe(false);
  });

  it("is the command bun src/cli/main.ts gate runs: CI=true gate --dry-run exits 4", () => {
    const result = spawnSync("bun", ["src/cli/main.ts", "gate", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
    });
    expect(result.status).toBe(4);
    expect(result.stderr).toContain("--dry-run is refused when CI=true");
  });

  it("exits 2 through the process for an unknown option", () => {
    const result = spawnSync("bun", ["src/cli/main.ts", "gate", "--nope"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown option "--nope"');
  });
});
