import { describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { ExecResult, LayerContext } from "../../gate/types.ts";
import { trackedFiles } from "./tracked.ts";

function context(result: ExecResult, calls: unknown[][]): LayerContext {
  return {
    cwd: "/work",
    config: cfg(),
    base: "origin/main",
    enforce: "hard",
    env: { A: "1" },
    exec: (command, args, options) => {
      calls.push([command, args, options]);
      return Promise.resolve(result);
    },
    outDir: "/work/out",
    artifacts: new Map(),
  };
}

describe("coverage: the files git tracks", () => {
  it("lists them from git ls-files -z in the project, with no empty name for the trailing NUL", async () => {
    const calls: unknown[][] = [];
    const found = await trackedFiles(
      context({ code: 0, stdout: "src/a.ts\0src/b.ts\0", stderr: "" }, calls),
    );
    expect(found).toEqual({ files: ["src/a.ts", "src/b.ts"] });
    expect(calls).toEqual([["git", ["ls-files", "-z"], { cwd: "/work", env: { A: "1" } }]]);
  });

  it("names git in the finding when it is not installed, or did not finish", async () => {
    const missing = await trackedFiles(
      context({ code: 127, stdout: "", stderr: "", failure: "tool-missing" }, []),
    );
    expect(missing).toMatchObject({
      finding: { rule: "tool-missing", message: "git is not installed or not on PATH" },
    });
    const slow = await trackedFiles(
      context({ code: 1, stdout: "", stderr: "", failure: "tool-timeout" }, []),
    );
    expect(slow).toMatchObject({
      finding: { rule: "tool-timeout", message: "git did not finish in time and was killed" },
    });
  });

  it("names git ls-files and what it said when it exits non-zero", async () => {
    const found = await trackedFiles(
      context({ code: 128, stdout: "", stderr: "not a git repository" }, []),
    );
    expect(found).toMatchObject({
      finding: {
        tool: "webtops",
        rule: "git-ls-files-failed",
        message: "git ls-files exited 128: not a git repository",
      },
    });
  });
});
