import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, LayerContext } from "../../gate/types.ts";
import { cleanTemp, tempDir } from "../../laws/probe/testkit.ts";
import { testsLayer } from "./index.ts";

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../../..");

function context(exec: Exec): LayerContext {
  const cwd = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
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
});
