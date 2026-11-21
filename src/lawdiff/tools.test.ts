import { describe, expect, it } from "vitest";
import { compareTools, isExact, toolsOf } from "./tools.ts";

describe("a version that names one release", () => {
  it("is major.minor.patch, with a prerelease or build, and not a range, a tag or a path", () => {
    for (const exact of ["1.2.3", "10.20.30", "1.2.3-rc.1", "1.2.3+build.5", "0.0.0"]) {
      expect(isExact(exact), exact).toBe(true);
    }
    for (const loose of [
      "^1.2.3",
      "~1.2.3",
      ">=1.2.3",
      "1.2",
      "1.2.3.4",
      "latest",
      "file:../x",
      "x1.2.3",
      "1.2.3 ",
      "",
    ]) {
      expect(isExact(loose), loose).toBe(false);
    }
  });
});

describe("the tools a project names", () => {
  it("are those of web-tops.lock, and of package.json the kit's own tools, each by file; the rest are other", () => {
    const manifest = {
      dependencies: { a: "1.0.0", eslint: "10.15.0" },
      devDependencies: { prettier: "^3.0.0", skipped: 3, webtops: "0.3.0" },
      peerDependencies: { c: "3.0.0", lockedOnly: "2.0.0" },
      optionalDependencies: { d: "4.0.0" },
    };
    const tools = toolsOf(
      manifest,
      new Map([
        ["lockedOnly", "2.0.0"],
        ["node", "^22"],
      ]),
    );
    expect([...tools]).toEqual([
      ["lock: lockedOnly", "2.0.0"],
      ["lock: node", "^22"],
      ["other: a", "1.0.0"],
      ["package.json: eslint", "10.15.0"],
      ["package.json: prettier", "^3.0.0"],
      ["package.json: webtops", "0.3.0"],
      ["other: c", "3.0.0"],
      ["package.json: lockedOnly", "2.0.0"],
    ]);
  });

  it("are none when there is neither a manifest nor a lock, and a manifest that is not an object has none", () => {
    expect(toolsOf(undefined, undefined).size).toBe(0);
    expect(toolsOf([], undefined).size).toBe(0);
    expect(toolsOf({ devDependencies: [] }, undefined).size).toBe(0);
    expect(toolsOf({ devDependencies: null }, undefined).size).toBe(0);
  });
});

const map = (entries: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(entries));

describe("the tools that moved", () => {
  it("lists every tool compared, in name order, as unchanged, changed, weakened or strengthened", () => {
    const base = map({
      a: "1.0.0",
      b: "1.0.0",
      c: "1.0.0",
      d: "1.0.0",
      e: "^1.0.0",
      gone: "1.0.0",
    });
    const head = map({
      a: "1.0.0",
      b: "1.1.0",
      c: "^1.0.0",
      d: "latest",
      e: "^1.1.0",
      fresh: "2.0.0",
      loose: "^2",
    });
    expect(compareTools(base, head)).toEqual([
      { what: "a", change: "unchanged", before: "1.0.0", after: "1.0.0" },
      { what: "b", change: "changed", before: "1.0.0", after: "1.1.0" },
      { what: "c", change: "weakened", before: "1.0.0", after: "^1.0.0" },
      { what: "d", change: "weakened", before: "1.0.0", after: "latest" },
      { what: "e", change: "changed", before: "^1.0.0", after: "^1.1.0" },
      { what: "fresh", change: "strengthened", before: "absent", after: "2.0.0" },
      { what: "gone", change: "weakened", before: "1.0.0", after: "removed" },
      { what: "loose", change: "weakened", before: "absent", after: "^2" },
    ]);
  });

  it("is empty when neither ref names a tool", () => {
    expect(compareTools(new Map(), new Map())).toEqual([]);
  });

  it("calls a range that is now pinned stronger, and one range changed for another changed", () => {
    expect(compareTools(map({ x: "^1.0.0" }), map({ x: "1.0.0" }))[0]?.change).toBe("strengthened");
    expect(compareTools(map({ x: "^1.0.0" }), map({ x: "^1.1.0" }))[0]?.change).toBe("changed");
  });

  it("lists a dependency that is not the kit's only when it changed, for review, never as weaker", () => {
    const base = map({
      "other: kept": "1.0.0",
      "other: bumped": "1.0.0",
      "other: dropped": "1.0.0",
    });
    const head = map({
      "other: kept": "1.0.0",
      "other: bumped": "2.0.0",
      "other: fresh": "^1.0.0",
    });
    expect(compareTools(base, head)).toEqual([
      { what: "other: bumped", change: "changed", before: "1.0.0", after: "2.0.0" },
      { what: "other: dropped", change: "changed", before: "1.0.0", after: "removed" },
      { what: "other: fresh", change: "changed", before: "absent", after: "^1.0.0" },
    ]);
  });
});
