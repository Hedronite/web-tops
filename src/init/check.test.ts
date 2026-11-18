import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { PROFILES } from "../config/profiles.ts";
import { checkConfigFile, validateConfig } from "../config/validate.ts";
import { runInit } from "./run.ts";
import { madeDirs, put, tempDir } from "./test-support.ts";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";

const root = resolve(import.meta.dirname, "../..");
const CLASSES = PROFILES.map((profile) => profile.class);

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

function webtops(
  cwd: string,
  ...args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", [join(root, "src/cli/main.ts"), ...args], {
    cwd,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("init then check", () => {
  it.each(CLASSES)(
    "the web-tops.yaml init writes for %s validates and passes the semantic checks",
    (className) => {
      const dir = tempDir();
      expect(runInit({ className, dir, force: false }).code).toBe(0);
      const path = join(dir, "web-tops.yaml");
      const schema = validateConfig(parse(readFileSync(path, "utf8")));
      expect(schema.ok, JSON.stringify(schema.ok ? [] : schema.problems)).toBe(true);
      const checked = checkConfigFile(path);
      expect(checked.ok, JSON.stringify(checked.ok ? [] : checked.problems)).toBe(true);
    },
  );

  it.each(CLASSES)(
    "init then check passes in a fresh temp directory for %s, through the CLI",
    (className) => {
      const dir = tempDir();
      const init = webtops(dir, "init", "--class", className);
      expect(init.status, init.stderr).toBe(0);
      const check = webtops(dir, "check");
      expect(check.status, check.stderr).toBe(0);
      expect(check.stdout).toContain(`class ${className}`);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "check fails on an init config once a gate hard forbids switching off is switched off",
    () => {
      const dir = tempDir();
      runInit({ className: "ts-library", dir, force: false });
      const text = readFileSync(join(dir, "web-tops.yaml"), "utf8");
      put(
        dir,
        "web-tops.yaml",
        text.replace("  tests:\n", '  tests:\n    enabled: false\n    reason: "planted"\n'),
      );
      const check = webtops(dir, "check");
      expect(check.status).toBe(2);
      expect(check.stderr).toContain("/gates/tests");
    },
    REAL_TOOL_TIMEOUT,
  );
});
