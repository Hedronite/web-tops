import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import type { CoverageOf, CoverageOfMany } from "./scope.ts";
import { diffScope } from "./scope.ts";
import { cleanRepos, commit, git, makeRepo, write } from "./test-support.ts";
import type { CoverageMap, ScopeResult } from "./types.ts";

// The changed test files are run together, once, and file by file only where that gives nothing: the functions in
// scope, the mutate ranges and the verdicts are those of a run of each file alone.

afterEach(cleanRepos);

const M = [
  "export function f(a: number): number {",
  "  return a + 1;",
  "}",
  "export function g(a: number): number {",
  "  return a * 2;",
  "}",
  "",
].join("\n");
const STRONG = 'import { f, g } from "./m.ts";\nf(1);\ng(2);\n';
const WEAK = 'import { f } from "./m.ts";\nf(1);\n';

/** What a run covered of src/m.ts: f at lines 1 to 3, g at 4 to 6. */
const ran = (f: boolean, g: boolean): CoverageMap =>
  new Map([
    [
      "src/m.ts",
      [
        { start: 1, end: 3, hits: f ? 1 : 0 },
        { start: 4, end: 6, hits: g ? 1 : 0 },
      ],
    ],
  ]);

function added(...names: string[]): string {
  const dir = makeRepo({ "src/m.ts": M });
  write(dir, Object.fromEntries(names.map((name) => [name, WEAK])));
  git(dir, "add", "-A");
  return dir;
}

function weakened(): string {
  const dir = makeRepo({ "src/m.ts": M, "src/m.test.ts": STRONG });
  git(dir, "switch", "-q", "-c", "weaken");
  write(dir, { "src/m.test.ts": WEAK, "src/n.test.ts": WEAK });
  commit(dir, "weaken one test and add another");
  return dir;
}

const keys = (result: ScopeResult): string[] =>
  result.outcome === "fail" ? [] : result.scope.coveredFunctions.map((ref) => ref.key);

describe("changed test files run together", () => {
  it("runs the head versions in one run, and none of them alone", async () => {
    const together: (readonly string[])[] = [];
    const alone: string[] = [];
    const result = await diffScope({
      cwd: added("src/a.test.ts", "src/b.test.ts", "src/c.test.ts"),
      base: "main",
      coverageOfMany: (group) => {
        together.push(group);
        return Promise.resolve(ran(true, true));
      },
      coverageOf: (file) => {
        alone.push(file);
        return Promise.resolve(undefined);
      },
    });
    expect(together).toEqual([["src/a.test.ts", "src/b.test.ts", "src/c.test.ts"]]);
    expect(alone).toEqual([]);
    expect(keys(result)).toEqual(["src/m.ts::f", "src/m.ts::g"]);
  });

  it("runs them one by one, in order, when the run together gives nothing, and adds up what each covered", async () => {
    const alone: string[] = [];
    const result = await diffScope({
      cwd: added("src/a.test.ts", "src/b.test.ts"),
      base: "main",
      coverageOfMany: () => Promise.resolve(undefined),
      coverageOf: (file) => {
        alone.push(file);
        return Promise.resolve(file === "src/a.test.ts" ? ran(true, false) : ran(false, true));
      },
    });
    expect(alone).toEqual(["src/a.test.ts", "src/b.test.ts"]);
    expect(keys(result)).toEqual(["src/m.ts::f", "src/m.ts::g"]);
  });

  it("fails naming the first file that cannot run alone, the later ones unnamed", async () => {
    const result = await diffScope({
      cwd: added("src/a.test.ts", "src/b.test.ts", "src/c.test.ts"),
      base: "main",
      coverageOfMany: () => Promise.resolve(undefined),
      coverageOf: (file) => Promise.resolve(file === "src/a.test.ts" ? ran(true, true) : undefined),
    });
    expect(result).toEqual({
      outcome: "fail",
      reason: "could not run src/b.test.ts to find the functions it covers",
    });
  });

  it("is the same scope as running each file alone", async () => {
    const dir = added("src/a.test.ts", "src/b.test.ts");
    const maps: Record<string, CoverageMap> = {
      "src/a.test.ts": ran(true, false),
      "src/b.test.ts": ran(false, true),
    };
    const alone: CoverageOf = (file) => Promise.resolve(maps[file]);
    const many: CoverageOfMany = () => Promise.resolve(ran(true, true));
    const one = await diffScope({ cwd: dir, base: "main", coverageOf: alone });
    const all = await diffScope({
      cwd: dir,
      base: "main",
      coverageOfMany: many,
      coverageOf: alone,
    });
    expect(all).toEqual(one);
  });

  it("runs the merge-base versions together too, as copies that are gone afterwards", async () => {
    const dir = weakened();
    const together: (readonly string[])[] = [];
    const seen: string[] = [];
    const result = await diffScope({
      copyToken: () => "tok",
      cwd: dir,
      base: "main",
      coverageOf: () => Promise.resolve(undefined),
      coverageOfMany: (group) => {
        together.push(group);
        for (const file of group) seen.push(existsSync(join(dir, file)) ? file : "");
        return Promise.resolve(
          group.some((file) => file.includes(".wt-base-")) ? ran(true, true) : ran(true, false),
        );
      },
    });
    expect(together).toEqual([["src/m.test.ts", "src/n.test.ts"], ["src/m.wt-base-tok.test.ts"]]);
    expect(seen).toEqual(["src/m.test.ts", "src/n.test.ts", "src/m.wt-base-tok.test.ts"]);
    expect(keys(result)).toEqual(["src/m.ts::f", "src/m.ts::g"]);
    expect(existsSync(join(dir, "src/m.wt-base-tok.test.ts"))).toBe(false);
  });

  it("holds the merge-base version in the copy, and runs a copy that fails together alone, leaving it out", async () => {
    const dir = weakened();
    const alone: string[] = [];
    const text: Record<string, string> = {};
    const result = await diffScope({
      copyToken: () => "tok",
      cwd: dir,
      base: "main",
      coverageOfMany: (group) =>
        Promise.resolve(
          group.some((file) => file.includes(".wt-base-")) ? undefined : ran(true, false),
        ),
      coverageOf: (file) => {
        alone.push(file);
        text[file] = readFileSync(join(dir, file), "utf8");
        return Promise.resolve(undefined);
      },
    });
    expect(alone).toEqual(["src/m.wt-base-tok.test.ts"]);
    expect(text["src/m.wt-base-tok.test.ts"]).toBe(STRONG.trim());
    expect(keys(result)).toEqual(["src/m.ts::f"]);
    expect(existsSync(join(dir, "src/m.wt-base-tok.test.ts"))).toBe(false);
  });

  it("leaves a merge-base version out when its runs throw, and still removes the copy", async () => {
    const dir = weakened();
    const result = await diffScope({
      copyToken: () => "tok",
      cwd: dir,
      base: "main",
      coverageOfMany: (group) => {
        if (group.some((file) => file.includes(".wt-base-"))) throw new Error("the run died");
        return Promise.resolve(ran(true, false));
      },
      coverageOf: () => {
        throw new Error("the run died");
      },
    });
    expect(keys(result)).toEqual(["src/m.ts::f"]);
    expect(existsSync(join(dir, "src/m.wt-base-tok.test.ts"))).toBe(false);
  });

  it("runs at most 100 files at once", async () => {
    const names = Array.from({ length: 205 }, (_, at) => `src/t${String(at)}.test.ts`);
    const sizes: number[] = [];
    await diffScope({
      cwd: added(...names),
      base: "main",
      coverageOfMany: (group) => {
        sizes.push(group.length);
        return Promise.resolve(ran(true, false));
      },
    });
    expect(sizes).toEqual([100, 100, 5]);
  });

  it("runs no group when it is given a source for one file only", async () => {
    const asked: string[] = [];
    const exec: Exec = (command, args, options) => {
      asked.push(command);
      return realExec(command, args, options);
    };
    const result = await diffScope({
      cwd: added("src/a.test.ts", "src/b.test.ts"),
      base: "main",
      exec,
      coverageOf: () => Promise.resolve(ran(true, false)),
    });
    expect(keys(result)).toEqual(["src/m.ts::f"]);
    expect(asked.filter((command) => command.includes("vitest"))).toEqual([]);
  });
});
