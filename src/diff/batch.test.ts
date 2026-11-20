import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Exec } from "../gate/types.ts";
import type { CoverageOf, CoverageOfMany } from "./scope.ts";
import { diffScope } from "./scope.ts";
import { cleanRepos, diffOf, fakeGit, plainDir } from "./test-support.ts";
import type { CoverageMap, FunctionHit, ScopeResult } from "./types.ts";

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

/** A project with src/m.ts and the given test files added, and the git that would say so. */
function added(...names: string[]): { cwd: string; exec: Exec } {
  const cwd = plainDir({ "src/m.ts": M, ...Object.fromEntries(names.map((name) => [name, WEAK])) });
  const exec = fakeGit(diffOf(names.map((path) => ({ path, kind: "added" }))));
  return { cwd, exec };
}

/** src/m.test.ts weakened and src/n.test.ts added, with the strong version of the first at the merge base. */
function weakened(): { cwd: string; exec: Exec } {
  const cwd = plainDir({ "src/m.ts": M, "src/m.test.ts": WEAK, "src/n.test.ts": WEAK });
  const diff = diffOf([
    { path: "src/m.test.ts", kind: "modified" },
    { path: "src/n.test.ts", kind: "added" },
  ]);
  return { cwd, exec: fakeGit(diff, { "src/m.test.ts": STRONG }) };
}

const keys = (result: ScopeResult): string[] =>
  result.outcome === "fail" ? [] : result.scope.coveredFunctions.map((ref) => ref.key);

describe("changed test files run together", () => {
  it("runs the head versions in one run, and none of them alone", async () => {
    const together: (readonly string[])[] = [];
    const alone: string[] = [];
    const result = await diffScope({
      ...added("src/a.test.ts", "src/b.test.ts", "src/c.test.ts"),
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
      ...added("src/a.test.ts", "src/b.test.ts"),
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
      ...added("src/a.test.ts", "src/b.test.ts", "src/c.test.ts"),
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
    const project = added("src/a.test.ts", "src/b.test.ts");
    const maps: Record<string, CoverageMap> = {
      "src/a.test.ts": ran(true, false),
      "src/b.test.ts": ran(false, true),
    };
    const alone: CoverageOf = (file) => Promise.resolve(maps[file]);
    const many: CoverageOfMany = () => Promise.resolve(ran(true, true));
    const one = await diffScope({ ...project, base: "main", coverageOf: alone });
    const all = await diffScope({
      ...project,
      base: "main",
      coverageOfMany: many,
      coverageOf: alone,
    });
    expect(all).toEqual(one);
  });

  it("runs the merge-base versions together too, as copies that are gone afterwards", async () => {
    const project = weakened();
    const together: (readonly string[])[] = [];
    const seen: string[] = [];
    const result = await diffScope({
      ...project,
      copyToken: () => "tok",
      base: "main",
      coverageOf: () => Promise.resolve(undefined),
      coverageOfMany: (group) => {
        together.push(group);
        for (const file of group) seen.push(existsSync(join(project.cwd, file)) ? file : "");
        return Promise.resolve(
          group.some((file) => file.includes(".wt-base-")) ? ran(true, true) : ran(true, false),
        );
      },
    });
    expect(together).toEqual([["src/m.test.ts", "src/n.test.ts"], ["src/m.wt-base-tok.test.ts"]]);
    expect(seen).toEqual(["src/m.test.ts", "src/n.test.ts", "src/m.wt-base-tok.test.ts"]);
    expect(keys(result)).toEqual(["src/m.ts::f", "src/m.ts::g"]);
    expect(existsSync(join(project.cwd, "src/m.wt-base-tok.test.ts"))).toBe(false);
  });

  it("holds the merge-base version in the copy, and runs a copy that fails together alone, leaving it out", async () => {
    const project = weakened();
    const alone: string[] = [];
    const text: Record<string, string> = {};
    const result = await diffScope({
      ...project,
      copyToken: () => "tok",
      base: "main",
      coverageOfMany: (group) =>
        Promise.resolve(
          group.some((file) => file.includes(".wt-base-")) ? undefined : ran(true, false),
        ),
      coverageOf: (file) => {
        alone.push(file);
        text[file] = readFileSync(join(project.cwd, file), "utf8");
        return Promise.resolve(undefined);
      },
    });
    expect(alone).toEqual(["src/m.wt-base-tok.test.ts"]);
    expect(text["src/m.wt-base-tok.test.ts"]).toBe(STRONG.trim());
    expect(keys(result)).toEqual(["src/m.ts::f"]);
    expect(existsSync(join(project.cwd, "src/m.wt-base-tok.test.ts"))).toBe(false);
  });

  it("leaves a merge-base version out when its runs throw, and still removes the copy", async () => {
    const project = weakened();
    const result = await diffScope({
      ...project,
      copyToken: () => "tok",
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
    expect(existsSync(join(project.cwd, "src/m.wt-base-tok.test.ts"))).toBe(false);
  });

  it("runs at most 100 files at once", async () => {
    const names = Array.from({ length: 205 }, (_, at) => `src/t${String(at)}.test.ts`);
    const sizes: number[] = [];
    await diffScope({
      ...added(...names),
      base: "main",
      coverageOfMany: (group) => {
        sizes.push(group.length);
        return Promise.resolve(ran(true, false));
      },
    });
    expect(sizes).toEqual([100, 100, 5]);
  });

  it("lists the functions by file and line, whatever order the coverage came in", async () => {
    const cwd = plainDir({ "src/z.ts": M, "src/a.ts": M, "src/t.test.ts": WEAK });
    const both = (path: string): [string, readonly FunctionHit[]] => [
      path,
      [
        { start: 4, end: 6, hits: 1 },
        { start: 1, end: 3, hits: 1 },
      ],
    ];
    const result = await diffScope({
      cwd,
      base: "main",
      exec: fakeGit(diffOf([{ path: "src/t.test.ts", kind: "added" }])),
      coverageOfMany: () => Promise.resolve(new Map([both("src/z.ts"), both("src/a.ts")])),
    });
    expect(keys(result)).toEqual(["src/a.ts::f", "src/a.ts::g", "src/z.ts::f", "src/z.ts::g"]);
  });

  it("runs no group when it is given a source for one file only", async () => {
    const asked: string[] = [];
    const project = added("src/a.test.ts", "src/b.test.ts");
    const exec: Exec = (command, args, options) => {
      asked.push(command);
      return project.exec(command, args, options);
    };
    const result = await diffScope({
      cwd: project.cwd,
      base: "main",
      exec,
      coverageOf: () => Promise.resolve(ran(true, false)),
    });
    expect(keys(result)).toEqual(["src/m.ts::f"]);
    expect(asked.filter((command) => command.includes("vitest"))).toEqual([]);
  });
});
