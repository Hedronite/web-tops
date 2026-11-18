import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statfsSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import { cfg } from "../../gate/testkit.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import type { LayerContext } from "../../gate/types.ts";
import { writeKitConfig } from "../tests/index.ts";
import { mutationLayer } from "./index.ts";

/**
 * G7c: E7 reproduced. The real Stryker, on the gate's Vitest wrapper, over the probe project whose function no test runs,
 * gives the counts the P3 recording holds, and the layer reads them through the status table.
 */

const root = resolve(import.meta.dirname, "../../..");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The disk rule for a Stryker run: it copies the project, so a machine over 90 % full or under 15 GiB free does not run it. */
function diskProblem(): string | undefined {
  const fs = statfsSync(tmpdir());
  const free = (fs.bavail * fs.bsize) / 2 ** 30;
  const used = 1 - fs.bfree / fs.blocks;
  if (used > 0.9 || free < 15) {
    return `disk blocked for Stryker: ${(used * 100).toFixed(0)} % used, ${free.toFixed(1)} GiB free`;
  }
  return undefined;
}

function probeProject(id: string): string {
  const dir = mkdtempSync(join(tmpdir(), "webtops-e7-"));
  dirs.push(dir);
  cpSync(resolve(root, "fixtures/probe", id, "src"), join(dir, "src"), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  writeFileSync(join(dir, ".gitignore"), "node_modules\n.web-tops\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "e7", private: true, type: "module" }),
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
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
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["add", "-A"],
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "base"],
  ]) {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  }
  return dir;
}

function contextFor(dir: string): LayerContext {
  const outDir = join(dir, ".web-tops", "out");
  mkdirSync(join(outDir, "tests"), { recursive: true });
  const wrapper = writeKitConfig(dir, join(outDir, "tests"));
  return {
    cwd: dir,
    config: cfg({ mutation: { scope: "all", maxSurvivors: 0, timeBudgetMinutes: 30 } }),
    base: "origin/main",
    enforce: "hard",
    env: { PATH: process.env["PATH"] },
    exec: realExec,
    outDir,
    artifacts: new Map([["vitest-config", wrapper]]),
  };
}

/**
 * Inside a Stryker worker (the kit's own mutation run) this test would start a second Stryker over a copy of the
 * sandbox, and measure that instead of the probe. The outer run's tests stand for it.
 */
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

describe.skipIf(insideStryker)("G7c E7 reproduced with the real Stryker", () => {
  it(
    "counts the NoCoverage mutants of a function no test runs as survivors, and the Killed ones not",
    async () => {
      const blocked = diskProblem();
      expect(blocked, blocked).toBeUndefined();
      const dir = probeProject("no-coverage-survivors");
      const result = await mutationLayer.run(contextFor(dir));
      expect(result.verdict).toBe("fail");
      const survivors = result.findings.filter((item) => item.rule === "no-coverage");
      expect(survivors).toHaveLength(6);
      expect(survivors.every((item) => item.survivor?.function === "src/price.ts::untested")).toBe(
        true,
      );
      expect(result.findings.some((item) => item.rule === "survived")).toBe(false);
    },
    REAL_TOOL_TIMEOUT * 4,
  );
});
