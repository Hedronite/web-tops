import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describeRun, recordTools } from "./run-info.ts";
import { tempProject } from "./testkit.ts";
import type { Exec, ExecResult } from "./types.ts";

/** G2a: the run block names the SHA, bun and node, and the version of every tool that ran, read from node_modules. */

const projects: ReturnType<typeof tempProject>[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    project.cleanup();
  }
});

function project(): ReturnType<typeof tempProject> {
  const made = tempProject();
  projects.push(made);
  return made;
}

function install(dir: string, name: string, version: string): void {
  const path = join(dir, "node_modules", name, "package.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ name, version }));
}

function ok(stdout: string): ExecResult {
  return { code: 0, stdout, stderr: "" };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** An exec that answers the four questions the description asks. */
function answering(answers: Readonly<Record<string, ExecResult>>): Exec {
  return (command, args) => {
    const result = answers[[command, ...args].join(" ")];
    return result === undefined
      ? Promise.reject(new Error(`unexpected ${command} ${args.join(" ")}`))
      : Promise.resolve(result);
  };
}

const ALL: Readonly<Record<string, ExecResult>> = {
  "git rev-parse HEAD": ok(`${SHA}\n`),
  "git rev-parse --show-prefix": ok("packages/fixture/\n"),
  "bun --version": ok("1.4.4\n"),
  "node --version": ok("v26.12.1\n"),
};

describe("G2a recordTools notes each package a node invocation ran from node_modules", () => {
  it("records a tool, a scoped tool and the innermost package of a nested install, once each, sorted", async () => {
    const seen: string[] = [];
    const base: Exec = (command, args) => {
      seen.push([command, ...args].join(" "));
      return Promise.resolve(ok("done"));
    };
    const recorder = recordTools(base);
    await recorder.exec("node", ["/p/node_modules/eslint/bin/eslint.js", "."]);
    await recorder.exec("node", ["/p/node_modules/@vitest/coverage-v8/x.js"]);
    await recorder.exec("node", ["/p/node_modules/eslint/bin/eslint.js", "src"]);
    await recorder.exec("node", ["/p/node_modules/a/node_modules/b/cli.js"]);
    expect(recorder.used()).toEqual(["@vitest/coverage-v8", "b", "eslint"]);
    expect(seen).toHaveLength(4);
  });

  it("ignores a runtime, git, and node run on something that is not in node_modules", async () => {
    const recorder = recordTools(() => Promise.resolve(ok("")));
    await recorder.exec("node", ["--version"]);
    await recorder.exec("node", ["/p/scripts/build.js"]);
    await recorder.exec("bun", ["install"]);
    await recorder.exec("git", ["status"]);
    expect(recorder.used()).toEqual([]);
  });

  it("returns the result and the rejection of the exec it wraps, untouched", async () => {
    const result = ok("x");
    expect(await recordTools(() => Promise.resolve(result)).exec("git", ["x"])).toBe(result);
    await expect(
      recordTools(() => Promise.reject(new Error("boom"))).exec("git", ["x"]),
    ).rejects.toThrow("boom");
  });
});

describe("G2a describeRun reads the SHA, the runtimes and the tool versions", () => {
  it("reads each from where it lives", async () => {
    const made = project();
    install(made.dir, "eslint", "9.39.5");
    install(made.dir, "@vitest/coverage-v8", "5.1.0");
    const description = await describeRun({
      cwd: made.dir,
      env: {},
      exec: answering(ALL),
      used: ["eslint", "@vitest/coverage-v8"],
    });
    expect(description).toEqual({
      root: "packages/fixture",
      sha: SHA,
      bun: "1.4.4",
      node: "26.12.1",
      tools: { "@vitest/coverage-v8": "5.1.0", eslint: "9.39.5" },
    });
  });

  it("the root is . when git prints no prefix", async () => {
    const made = project();
    const exec = answering({ ...ALL, "git rev-parse --show-prefix": ok("\n") });
    expect((await describeRun({ cwd: made.dir, env: {}, exec, used: [] })).root).toBe(".");
  });

  it("gives null for what cannot be read: not a git repo, no bun, an exec that throws", async () => {
    const made = project();
    const failing: ExecResult = { code: 128, stdout: "", stderr: "fatal: not a git repository" };
    const exec = answering({
      "git rev-parse HEAD": failing,
      "git rev-parse --show-prefix": failing,
      "bun --version": { code: null, stdout: "", stderr: "", failure: "tool-missing" },
      "node --version": ok("v26.12.1\n"),
    });
    expect(await describeRun({ cwd: made.dir, env: {}, exec, used: [] })).toEqual({
      root: ".",
      sha: null,
      bun: null,
      node: "26.12.1",
      tools: {},
    });
    const throwing: Exec = () => Promise.reject(new Error("no exec"));
    expect(await describeRun({ cwd: made.dir, env: {}, exec: throwing, used: [] })).toEqual({
      root: ".",
      sha: null,
      bun: null,
      node: null,
      tools: {},
    });
  });

  it("a SHA that is not 40 hex characters is null, and a tool whose package.json cannot be read is left out", async () => {
    const made = project();
    install(made.dir, "eslint", "9.39.5");
    const exec = answering({ ...ALL, "git rev-parse HEAD": ok("HEAD\n") });
    const description = await describeRun({
      cwd: made.dir,
      env: {},
      exec,
      used: ["eslint", "not-installed"],
    });
    expect(description.sha).toBeNull();
    expect(description.tools).toEqual({ eslint: "9.39.5" });
  });
});
