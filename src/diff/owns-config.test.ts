import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ownsTrackedConfig, selfGatedExample } from "./examples.ts";
import { diffScope } from "./scope.ts";
import { git, makeRepo, write } from "./test-support.ts";

/**
 * An example is left out of the diff, and of W-04's compiler file set, when its own folder tracks `web-tops.yaml`
 * (WEB_TOPS.md sections 6.4 and 6.5).
 */

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const TRACKED = new Set([
  "web-tops.yaml",
  "examples/gates/web-tops.yaml",
  "poire/ts/web-tops.yaml",
  "poire/a/b/web-tops.yaml",
  "examples/a/b/web-tops.yaml",
  "src/x/web-tops.yaml",
  "packages/x/web-tops.yaml",
]);

describe("the one rule for an example that gates itself", () => {
  const found = (path: string): string | undefined =>
    selfGatedExample(path, ownsTrackedConfig(TRACKED));

  it("holds for every file of an examples/<name> that tracks its own web-tops.yaml", () => {
    expect(found("examples/gates/src/a.ts")).toBe("examples/gates");
    expect(found("examples/gates/vite.config.ts")).toBe("examples/gates");
  });

  it("holds the same way for a poire/<name> that tracks its own web-tops.yaml", () => {
    expect(found("poire/ts/src/a.ts")).toBe("poire/ts");
    expect(found("poire/ts/fixtures/lint/counter.ts")).toBe("poire/ts");
  });

  it.each([
    ["an example with no tracked config", "examples/loose/src/a.ts"],
    ["a config two levels down", "examples/a/b/src/c.ts"],
    ["a config under src/", "src/x/y.ts"],
    ["a config under packages/", "packages/x/y.ts"],
    ["an examples/ that is not at the top", "docs/examples/gates/a.ts"],
    ["the root project's own file", "src/a.ts"],
    ["a file directly under examples/", "examples/run.ts"],
    ["a poire/ project with no tracked config", "poire/go/src/a.ts"],
    ["a poire/ config two levels down", "poire/a/b/src/c.ts"],
    ["a poire/ that is not at the top", "docs/poire/ts/a.ts"],
    ["a file directly under poire/", "poire/run.ts"],
  ])("does not hold for %s", (_name, path) => {
    expect(found(path)).toBeUndefined();
  });
});

describe("the diff scope asks git which examples track a config", () => {
  it("leaves out a tracked one's files, and keeps those of an example whose config is untracked", async () => {
    const dir = makeRepo({
      "src/a.ts": "export const a = 1;\n",
      "examples/gates/web-tops.yaml": "class: cli\n",
      "examples/gates/src/b.ts": "export const b = 1;\n",
      "examples/loose/src/c.ts": "export const c = 1;\n",
    });
    made.push(dir);
    git(dir, "switch", "-q", "-c", "work");
    write(dir, {
      "examples/gates/src/b.ts": "export const b = 2;\n",
      "examples/loose/src/c.ts": "export const c = 2;\n",
    });
    git(dir, "commit", "-q", "-a", "-m", "work");
    // Written, never added: it exempts nothing.
    write(dir, { "examples/loose/web-tops.yaml": "class: cli\n" });
    const result = await diffScope({
      cwd: dir,
      base: "main",
      coverageOf: () => Promise.resolve(new Map()),
    });
    const mutated = result.outcome === "fail" ? [result.reason] : result.scope.mutate;
    expect(mutated.map((entry) => entry.replace(/:.*$/u, ""))).toEqual(["examples/loose/src/c.ts"]);
  });

  it("leaves a poire/<name> project out of the root's diff, and gives that project its own files from its directory", async () => {
    const dir = makeRepo({
      "src/a.ts": "export const a = 1;\n",
      "poire/ts/web-tops.yaml": "class: ts-library\n",
      "poire/ts/src/b.ts": "export const b = 1;\n",
    });
    made.push(dir);
    git(dir, "switch", "-q", "-c", "work");
    write(dir, {
      "src/a.ts": "export const a = 2;\n",
      "poire/ts/src/b.ts": "export const b = 2;\n",
    });
    git(dir, "commit", "-q", "-a", "-m", "work");
    const scopeAt = async (cwd: string): Promise<string[]> => {
      const result = await diffScope({
        cwd,
        base: "main",
        coverageOf: () => Promise.resolve(new Map()),
      });
      return result.outcome === "fail"
        ? [result.reason]
        : result.scope.mutate.map((entry) => entry.replace(/:.*$/u, ""));
    };
    expect(await scopeAt(dir)).toEqual(["src/a.ts"]);
    expect(await scopeAt(join(dir, "poire", "ts"))).toEqual(["src/b.ts"]);
  });

  it("fails, and never guesses, when git cannot list the tracked files", async () => {
    const dir = makeRepo({ "src/a.ts": "export const a = 1;\n" });
    made.push(dir);
    const result = await diffScope({
      cwd: dir,
      base: "main",
      exec: (_command, args) =>
        Promise.resolve(
          args[0] === "ls-files"
            ? { code: 128, stdout: "", stderr: "index is locked" }
            : { code: 0, stdout: args[0] === "merge-base" ? "abc" : "", stderr: "" },
        ),
    });
    expect(result).toEqual({ outcome: "fail", reason: "index is locked" });
  });
});
