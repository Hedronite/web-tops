import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { TOOL_PINS } from "./pins.ts";
import { candidateTools, exactDeps } from "./candidates.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

describe("exactDeps", () => {
  it("reads exact versions from dependencies and devDependencies", () => {
    const doc = { dependencies: { a: "1.0.0" }, devDependencies: { b: "2.3.4", "@s/c": "0.1.0" } };
    expect(exactDeps(doc).sort()).toEqual(["@s/c", "a", "b"]);
  });

  it.each([["^1.2.3"], ["~1.2.3"], ["latest"], ["workspace:*"], ["github:o/r"], [">=1"], ["1.x"]])(
    "does not take %s",
    (spec) => {
      expect(exactDeps({ devDependencies: { x: spec } })).toEqual([]);
    },
  );

  it("takes a prerelease exact version", () => {
    expect(exactDeps({ devDependencies: { x: "1.0.0-rc.1" } })).toEqual(["x"]);
  });

  it("ignores peer and optional dependencies, and a value that is not a string", () => {
    const doc = { peerDependencies: { p: "1.0.0" }, optionalDependencies: { o: "1.0.0" } };
    expect(exactDeps(doc)).toEqual([]);
    expect(exactDeps({ dependencies: { n: 1 } })).toEqual([]);
  });

  it.each([
    [null],
    [undefined],
    ["text"],
    [[]],
    [{}],
    [{ dependencies: "x" }],
    [{ dependencies: [] }],
  ])("returns nothing for %j", (doc) => {
    expect(exactDeps(doc)).toEqual([]);
  });
});

describe("candidateTools", () => {
  it("is every pinned tool when the project has no package.json", () => {
    const result = candidateTools(tempDir());
    expect(result).toEqual({ ok: true, names: Object.keys(TOOL_PINS).sort() });
  });

  it("adds the exact package.json entries to the pins, once each and sorted", () => {
    const dir = tempDir();
    put(
      dir,
      "package.json",
      JSON.stringify({
        devDependencies: { zod: "4.6.7", "fast-check": "4.10.2", loose: "^1.0.0" },
      }),
    );
    const result = candidateTools(dir);
    expect(result.ok && result.names).toEqual(
      [...new Set([...Object.keys(TOOL_PINS), "fast-check"])].sort(),
    );
  });

  it("never offers webtops or node, which the lock handles itself", () => {
    const dir = tempDir();
    put(
      dir,
      "package.json",
      JSON.stringify({ dependencies: { webtops: "0.2.0", node: "24.0.0" } }),
    );
    const result = candidateTools(dir);
    expect(result.ok && result.names).not.toContain("webtops");
    expect(result.ok && result.names).not.toContain("node");
  });

  it("fails on a package.json that is not valid JSON, naming the file", () => {
    const dir = tempDir();
    put(dir, "package.json", "{ not json");
    const result = candidateTools(dir);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("package.json");
  });
});
