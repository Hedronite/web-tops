import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { at, get } from "../config/test-support.ts";
import { parseCoverage } from "./coverage.ts";
import { diffScope } from "./scope.ts";
import type { DiffScope, ScopeResult } from "./types.ts";
import { cleanRepos, commit, emptyRepo, git, makeRepo, write } from "./test-support.ts";

afterEach(cleanRepos);

const A = [
  "export function one(a: number): number {",
  "  return a + 1;",
  "}",
  "export function two(a: number): number {",
  "  return a * 2;",
  "}",
  "",
].join("\n");

const probe = join(import.meta.dirname, "../../fixtures/probe");

function keys(list: readonly { key: string }[]): string[] {
  return list.map((entry) => entry.key);
}

function scopeOf(result: ScopeResult): DiffScope | undefined {
  return result.outcome === "fail" ? undefined : result.scope;
}

describe("G6a: changed ranges and functions against the merge base", () => {
  it("lists the changed lines and the functions they fall in, from a branch off main", async () => {
    const dir = makeRepo({ "src/a.ts": A, "README.md": "# a\n" });
    git(dir, "switch", "-q", "-c", "feature");
    write(dir, {
      "src/a.ts": `${A.replace("a * 2", "a * 3")}export function three(): number {\n  return 3;\n}\n`,
      "README.md": "# b\n",
    });
    commit(dir, "change");
    // main moves on: the merge base, not main's tip, is what the diff is taken against
    git(dir, "switch", "-q", "main");
    write(dir, { "other.txt": "x\n" });
    commit(dir, "main moves");
    git(dir, "switch", "-q", "feature");
    const result = await diffScope({ cwd: dir, base: "main" });
    expect(result.outcome).toBe("scope");
    if (result.outcome !== "scope") return;
    // git aligns the appended function's closing brace of `two` as part of the change: lines 5 to 8
    expect(result.scope.mutate).toEqual(["src/a.ts:5-8"]);
    expect(keys(result.scope.changedFunctions)).toEqual(["src/a.ts::two", "src/a.ts::three"]);
    expect(result.scope.files.map((file) => file.path).sort()).toEqual(["README.md", "src/a.ts"]);
    expect(result.scope.mergeBase).toBe(git(dir, "merge-base", "HEAD", "main"));
  });

  it("agrees with git diff -U0 on the new-side lines of each change", async () => {
    const dir = makeRepo({ "src/a.ts": A });
    git(dir, "switch", "-q", "-c", "feature");
    write(dir, { "src/a.ts": A.replace("a + 1", "a + 10").replace("a * 2", "a * 20") });
    commit(dir, "change");
    const raw = git(dir, "diff", "-U0", "main", "--", "src/a.ts");
    const headers = [...raw.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)].map(
      (match) => `${match[1] ?? ""}-${String(Number(match[1]) + Number(match[2] ?? 1) - 1)}`,
    );
    const result = await diffScope({ cwd: dir, base: "main" });
    expect(get(result, "scope")).toBeDefined();
    expect(at(result, ["scope", "mutate"])).toEqual(headers.map((range) => `src/a.ts:${range}`));
  });

  it("includes uncommitted changes to tracked files", async () => {
    const dir = makeRepo({ "src/a.ts": A });
    write(dir, { "src/a.ts": A.replace("a + 1", "a + 2") });
    const result = await diffScope({ cwd: dir, base: "main" });
    expect(at(result, ["scope", "mutate"])).toEqual(["src/a.ts:2-2"]);
    expect(keys(scopeOf(result)?.changedFunctions ?? [])).toEqual(["src/a.ts::one"]);
  });

  it("maps a deletion to the function it was taken from, and mutates nothing (so it is vacuous)", async () => {
    const dir = makeRepo({
      "src/a.ts": A.replace("  return a + 1;", "  const b = a;\n  return a + 1;"),
    });
    write(dir, { "src/a.ts": A });
    const result = await diffScope({ cwd: dir, base: "main" });
    expect(result.outcome).toBe("vacuous");
    expect(keys(scopeOf(result)?.changedFunctions ?? [])).toEqual(["src/a.ts::one"]);
    expect(at(result, ["scope", "mutate"])).toEqual([]);
  });

  it("does not mutate test files or declaration files, and ignores non-source files", async () => {
    const dir = makeRepo({ "src/a.ts": A });
    write(dir, {
      "src/a.test.ts": "export const t = 1;\n",
      "src/x.d.ts": "export {};\n",
      "notes.md": "x\n",
    });
    commit(dir, "more");
    git(dir, "switch", "-q", "-c", "feature");
    write(dir, {
      "src/a.test.ts": "export const t = 2;\n",
      "src/x.d.ts": "export {};\n\n",
      "notes.md": "y\n",
    });
    const result = await diffScope({
      cwd: dir,
      base: "main",
      coverageOf: () => Promise.resolve(new Map()),
    });
    expect(result.outcome).toBe("vacuous");
    expect(scopeOf(result)?.mutate).toEqual([]);
    expect(scopeOf(result)?.testFiles).toEqual(["src/a.test.ts"]);
  });
});

describe("G6b: a diff that cannot be taken fails; one with nothing to mutate is vacuous", () => {
  it("fails on a shallow clone, with the reason", async () => {
    const origin = makeRepo({ "src/a.ts": A });
    write(origin, { "src/a.ts": `${A}// second\n` });
    commit(origin, "second");
    const clone = emptyRepo();
    git(clone, "remote", "add", "origin", `file://${origin}`);
    git(clone, "fetch", "-q", "--depth", "1", "origin", "main");
    git(clone, "switch", "-q", "-c", "work", "FETCH_HEAD");
    const result = await diffScope({ cwd: clone, base: "origin/main" });
    expect(result).toMatchObject({ outcome: "fail" });
    expect(get(result, "reason")).toMatch(/shallow/);
    expect(get(result, "reason")).toMatch(/fetch-depth: 0/);
  });

  it("fails when the base does not exist, naming it", async () => {
    const dir = makeRepo({ "src/a.ts": A });
    const result = await diffScope({ cwd: dir, base: "origin/nowhere" });
    expect(result).toMatchObject({ outcome: "fail" });
    expect(get(result, "reason")).toContain("origin/nowhere");
  });

  it("fails when HEAD and the base share no history", async () => {
    const dir = makeRepo({ "src/a.ts": A });
    git(dir, "switch", "-q", "--orphan", "island");
    write(dir, { "src/b.ts": "export const b = 1;\n" });
    commit(dir, "island");
    const result = await diffScope({ cwd: dir, base: "main" });
    expect(result).toMatchObject({ outcome: "fail" });
    expect(get(result, "reason")).toMatch(/merge base/);
  });

  it("fails outside a git work tree", async () => {
    const result = await diffScope({ cwd: "/", base: "main" });
    expect(result.outcome).toBe("fail");
  });

  it("is vacuous on an empty diff, and says why", async () => {
    const dir = makeRepo({ "src/a.ts": A });
    git(dir, "switch", "-q", "-c", "feature");
    const result = await diffScope({ cwd: dir, base: "main" });
    expect(result.outcome).toBe("vacuous");
    expect(get(result, "reason")).toMatch(/no changed source line/);
  });

  it("is vacuous when only non-source files changed", async () => {
    const dir = makeRepo({ "src/a.ts": A, "README.md": "a\n" });
    write(dir, { "README.md": "b\n" });
    expect((await diffScope({ cwd: dir, base: "main" })).outcome).toBe("vacuous");
  });
});

describe("G6c: a test-only diff maps to the functions its tests cover", () => {
  const sum = readFileSync(join(probe, "test-only-diff/src/sum.ts"), "utf8");
  const weak = readFileSync(join(probe, "test-only-diff/src/sum.test.ts"), "utf8");
  const strong = weak
    .replace("import { it }", "import { expect, it }")
    .replace("  sum([1, 2, 3]);", "  expect(sum([1, 2, 3])).toBe(6);");
  const recorded: unknown = JSON.parse(
    readFileSync(join(probe, "test-only-diff/recorded/coverage-final.json"), "utf8"),
  );

  function weakened(): string {
    const dir = makeRepo({ "src/sum.ts": sum, "src/sum.test.ts": strong });
    git(dir, "switch", "-q", "-c", "weaken");
    write(dir, { "src/sum.test.ts": weak });
    commit(dir, "weaken the test");
    return dir;
  }

  it("lists sum, as EXPECTED.yaml says, and mutates its whole range", async () => {
    const asked: string[] = [];
    const result = await diffScope({
      cwd: weakened(),
      base: "main",
      coverageOf: (testFile) => {
        asked.push(testFile);
        return Promise.resolve(parseCoverage(recorded));
      },
    });
    expect(result.outcome).toBe("scope");
    if (result.outcome !== "scope") return;
    expect(asked).toEqual(["src/sum.test.ts"]);
    expect(result.scope.testFiles).toEqual(["src/sum.test.ts"]);
    expect(result.scope.changedFunctions).toEqual([]);
    expect(keys(result.scope.coveredFunctions)).toEqual(["src/sum.ts::sum"]);
    expect(result.scope.mutate).toEqual(["src/sum.ts:1-7"]);
    const expected: unknown = parse(readFileSync(join(probe, "EXPECTED.yaml"), "utf8"));
    const cases = get(expected, "cases");
    const list: unknown[] = Array.isArray(cases) ? cases : [];
    const found = list.find((entry) => get(entry, "id") === "test-only-diff");
    expect(at(found, ["outcome", "scope"])).toEqual(keys(result.scope.coveredFunctions));
  });

  it("is vacuous when the changed test covers nothing", async () => {
    const result = await diffScope({
      cwd: weakened(),
      base: "main",
      coverageOf: () => Promise.resolve(new Map()),
    });
    expect(result.outcome).toBe("vacuous");
  });

  it("fails when the changed test could not be run to find what it covers", async () => {
    const result = await diffScope({
      cwd: weakened(),
      base: "main",
      coverageOf: () => Promise.resolve(undefined),
    });
    expect(result).toMatchObject({ outcome: "fail" });
    expect(get(result, "reason")).toContain("src/sum.test.ts");
  });

  it("does not ask for coverage when no test file changed, or when a test file was deleted", async () => {
    const asked: string[] = [];
    const coverageOf = (file: string): Promise<undefined> => {
      asked.push(file);
      return Promise.resolve(undefined);
    };
    const dir = makeRepo({ "src/sum.ts": sum, "src/sum.test.ts": strong });
    write(dir, { "src/sum.ts": `${sum}// edit\n` });
    expect((await diffScope({ cwd: dir, base: "main", coverageOf })).outcome).toBe("scope");
    git(dir, "rm", "-q", "src/sum.test.ts");
    await diffScope({ cwd: dir, base: "main", coverageOf });
    expect(asked).toEqual([]);
  });

  it("adds the covered functions to the changed lines, with no range twice", async () => {
    const dir = makeRepo({ "src/sum.ts": sum, "src/sum.test.ts": strong });
    write(dir, {
      "src/sum.ts": sum.replace("total += x;", "total += x + 0;"),
      "src/sum.test.ts": weak,
    });
    const result = await diffScope({
      cwd: dir,
      base: "main",
      coverageOf: () => Promise.resolve(parseCoverage(recorded)),
    });
    expect(at(result, ["scope", "mutate"])).toEqual(["src/sum.ts:1-7"]);
  });
});
