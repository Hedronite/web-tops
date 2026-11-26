import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, LayerContext } from "../../gate/types.ts";
import { cleanTemp, tempDir } from "../../laws/probe/testkit.ts";
import { runTool } from "../hygiene/tooling.ts";
import { SKIPPED, STACK_FRAME, TESTS_TIMEOUT_MS, testsLayer } from "./index.ts";

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../../..");

function context(exec: Exec, installed = true): LayerContext {
  const cwd = tempDir();
  if (installed) {
    symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
  }
  return {
    cwd,
    config: cfg(),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec,
    outDir: join(cwd, ".web-tops", "out"),
    artifacts: new Map(),
  };
}

describe("gate 2 says which tool it could not run", () => {
  it("names vitest when it did not finish in time and was killed", async () => {
    const exec: Exec = () =>
      Promise.resolve({ code: null, stdout: "", stderr: "", failure: "tool-timeout" });
    const result = await testsLayer.run(context(exec));
    expect(result.verdict).toBe("fail");
    expect(result.findings).toMatchObject([
      { rule: "tool-timeout", message: "vitest did not finish in time and was killed" },
    ]);
  });

  it("is tool-missing, with nothing on stdout, when vitest is not installed in the project", async () => {
    const exec: Exec = () => Promise.reject(new Error("nothing is started"));
    const result = await runTool(context(exec, false), "vitest", []);
    expect(result).toEqual({
      code: null,
      stdout: "",
      stderr: "vitest is not installed in node_modules (package vitest)",
      failure: "tool-missing",
    });
  });

  it("passes explicit TESTS_TIMEOUT_MS to exec so vitest gets process-group cleanup", async () => {
    let seenTimeout: number | undefined;
    const exec: Exec = (_command, _args, options) => {
      seenTimeout = options?.timeoutMs;
      return Promise.resolve({ code: null, stdout: "", stderr: "", failure: "tool-timeout" });
    };
    await testsLayer.run(context(exec));
    expect(TESTS_TIMEOUT_MS).toBe(1_200_000);
    expect(seenTimeout).toBe(TESTS_TIMEOUT_MS);
  });

  it("exposes classes, skipped statuses, and anchored stack frame matcher", () => {
    expect(testsLayer.classes).toEqual([
      "ts-library",
      "ui-components",
      "astro-site",
      "web-app",
      "node-service",
    ]);
    expect(testsLayer.requires).toEqual([]);
    expect(SKIPPED.has("pending")).toBe(true);
    expect(SKIPPED.has("disabled")).toBe(true);
    expect(STACK_FRAME.test("  at foo")).toBe(true);
    expect(STACK_FRAME.test("  ❯ foo")).toBe(true);
    expect(STACK_FRAME.test("received at step 2")).toBe(false);
  });
});
