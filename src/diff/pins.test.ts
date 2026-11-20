import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import { COVERAGE_INCLUDE, DEFAULT_COVERAGE_EXCLUDES } from "../layers/coverage/scope.ts";
import { coveredSpans, parseCoverage } from "./coverage.ts";
import { functionsIn, innermostAt } from "./functions.ts";
import { mergeBaseOf } from "./git.ts";
import { diffScope, isSourceFile, isTestFile } from "./scope.ts";
import { cleanRepos, commit, git, makeRepo, write } from "./test-support.ts";
import type { CoverageMap } from "./types.ts";

// What the diff step does at its edges, pinned one fact at a time.

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
const TEST = 'import { f, g } from "./m.ts";\nf(1);\ng(2);\n';

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

describe("which paths are tests and which are source", () => {
  it.each([
    "a.test.ts",
    "a.spec.ts",
    "a.test.tsx",
    "a.test.mts",
    "a.spec.cts",
    "src/__tests__/a.ts",
    "__tests__/a.ts",
  ])("%s is a test", (path) => {
    expect(isTestFile(path)).toBe(true);
    expect(isSourceFile(path)).toBe(false);
  });

  it.each(["a.ts", "a.tsx", "a.mts", "a.cts", "a.test.tsy.ts", "a.d.ts.ts", "src/__tests__x/a.ts"])(
    "%s is source",
    (path) => {
      expect(isSourceFile(path)).toBe(true);
      expect(isTestFile(path)).toBe(false);
    },
  );

  it.each(["a.js", "a.ts.bak", "a.test.js", "src/__tests__/a.js", "a.d.ts", "a.d.mts", "a.d.cts"])(
    "%s is neither",
    (path) => {
      expect(isSourceFile(path)).toBe(false);
      expect(isTestFile(path)).toBe(false);
    },
  );
});

describe("coverage maps", () => {
  it("refuses a file whose functions have no location, and keeps one that has them", () => {
    const entry = { loc: { start: { line: 1 }, end: { line: 2 } } };
    expect(parseCoverage({ "a.ts": { fnMap: { 0: {} }, f: { 0: 1 } } })).toBeUndefined();
    expect(parseCoverage({ "a.ts": { fnMap: { 0: entry }, f: { 0: 1 } } })?.get("a.ts")).toEqual([
      { start: 1, end: 2, hits: 1 },
    ]);
  });

  it("takes no work-tree prefix off a path when it is given none", () => {
    const file = { fnMap: { 0: { loc: { start: { line: 1 }, end: { line: 2 } } } }, f: { 0: 1 } };
    expect([...(parseCoverage({ "/work/a.ts": file })?.keys() ?? [])]).toEqual(["/work/a.ts"]);
  });

  const spans = [
    { key: "a.ts::<module>", start: 1, end: 20 },
    { key: "a.ts::f", start: 3, end: 10 },
    { key: "a.ts::g", start: 12, end: 15 },
  ];

  it("never lists the module as a covered function, whatever ran in it", () => {
    expect(coveredSpans(spans, [{ start: 1, end: 20, hits: 3 }])).toEqual([]);
  });

  it("gives a hit to a function only when the function holds all of it", () => {
    expect(coveredSpans(spans, [{ start: 5, end: 11, hits: 1 }])).toEqual([]);
    expect(coveredSpans(spans, [{ start: 5, end: 8, hits: 1 }]).map((span) => span.key)).toEqual([
      "a.ts::f",
    ]);
  });
});

describe("functions of a file", () => {
  it("leaves out what has no body: overloads, abstract members and signatures", () => {
    const text = [
      "export function ov(a: string): void;",
      "export function ov(a: number): void;",
      "export function ov(a: string | number): void {}",
      "abstract class A {",
      "  abstract m(): void;",
      "}",
      "interface I {",
      "  n(): void;",
      "}",
      "namespace N {",
      "  export const x = 1;",
      "}",
      "",
    ].join("\n");
    expect(functionsIn("a.ts", text).map((span) => span.key)).toEqual([
      "a.ts::<module>",
      "a.ts::ov",
    ]);
  });

  it("reads a .ts file as TypeScript, where a generic arrow is not JSX", () => {
    const keys = functionsIn("a.ts", "const f = <T,>(a: T) => a;\nconst h = <T>(a: T) => a;\n");
    expect(keys.map((span) => span.key)).toEqual(["a.ts::<module>", "a.ts::f", "a.ts::h"]);
  });

  it("reads a .tsx file as TSX", () => {
    const keys = functionsIn("a.tsx", "const v = <div>{[1].map((x) => x)}</div>;\n");
    expect(keys.map((span) => span.key)).toEqual(["a.tsx::<module>", "a.tsx::<module>#1"]);
  });

  it("ends the module where the text ends, with or without a last newline", () => {
    expect(functionsIn("a.ts", "const a = 1;\nconst b = 2;\n")[0]?.end).toBe(2);
    expect(functionsIn("a.ts", "const a = 1;\nconst b = 2;")[0]?.end).toBe(2);
    expect(functionsIn("a.ts", "const a = 1;\n\n")[0]?.end).toBe(2);
  });

  it("picks the innermost span whatever order they come in, and the later of two of one size", () => {
    const outer = { key: "o", start: 1, end: 10 };
    const inner = { key: "i", start: 3, end: 4 };
    expect(innermostAt([outer, inner], 3)?.key).toBe("i");
    expect(innermostAt([inner, outer], 3)?.key).toBe("i");
    expect(innermostAt([{ ...inner, key: "x" }, inner], 3)?.key).toBe("i");
  });
});

describe("what git says when it fails", () => {
  const failing =
    (stderr: string, stdout = "", code = 1): Exec =>
    () =>
      Promise.resolve({ code, stdout, stderr });

  it("is its own words, trimmed", async () => {
    expect(await mergeBaseOf(failing("  boom \n"), "/x", "main")).toEqual({
      ok: false,
      reason: "not a git work tree: boom",
    });
  });

  it("is the command that failed when git said nothing", async () => {
    expect(await mergeBaseOf(failing(""), "/x", "main")).toEqual({
      ok: false,
      reason: "not a git work tree: git rev-parse --is-inside-work-tree failed",
    });
  });

  it("is that there is no merge base when git printed none", async () => {
    expect(await mergeBaseOf(failing("", "", 0), "/x", "main")).toEqual({
      ok: false,
      reason: "there is no merge base between HEAD and main",
    });
  });
});

/** What the fake Vitest does with a run: fail a run of two or more files, else write a report that covers f. */
function fakeVitest(args: readonly string[]): { code: number; stdout: string; stderr: string } {
  const flag = args.find((arg) => arg.startsWith("--coverage.reportsDirectory=")) ?? "";
  const files = args.filter((arg) => arg.endsWith(".test.ts"));
  if (files.length > 1) return { code: 1, stdout: "", stderr: "" };
  const loc = { start: { line: 1 }, end: { line: 3 } };
  const report = { "src/m.ts": { fnMap: { 0: { loc } }, f: { 0: 1 } } };
  write(flag.slice("--coverage.reportsDirectory=".length), {
    "coverage-final.json": JSON.stringify(report),
  });
  return { code: 0, stdout: "", stderr: "" };
}

/** Git runs for real; Vitest is a fake that keeps its arguments. */
function spied(): { exec: Exec; vitest: string[][]; shows: string[][] } {
  const vitest: string[][] = [];
  const shows: string[][] = [];
  const exec: Exec = (command, args, options) => {
    if (command !== "git") {
      vitest.push([...args]);
      return Promise.resolve(fakeVitest(args));
    }
    if (args[0] === "show") shows.push([...args]);
    return realExec(command, args, options);
  };
  return { exec, vitest, shows };
}

describe("the default runs of Vitest", () => {
  function added(): string {
    const dir = makeRepo({ "src/m.ts": M });
    write(dir, { "src/a.test.ts": TEST, "src/b.test.ts": TEST });
    git(dir, "add", "-A");
    return dir;
  }

  it("runs both files together first, then each alone where that fails, under the gate's own options", async () => {
    const { exec, vitest } = spied();
    const result = await diffScope({ cwd: added(), base: "main", exec });
    expect(vitest.map((args) => args.filter((arg) => arg.endsWith(".test.ts")))).toEqual([
      ["src/a.test.ts", "src/b.test.ts"],
      ["src/a.test.ts"],
      ["src/b.test.ts"],
    ]);
    const first = vitest[0] ?? [];
    expect(first.slice(0, 3)).toEqual(["run", "src/a.test.ts", "src/b.test.ts"]);
    expect(first.filter((arg) => arg.startsWith("--coverage.exclude="))).toEqual(
      DEFAULT_COVERAGE_EXCLUDES.map((glob) => `--coverage.exclude=${glob}`),
    );
    expect(first).toContain(`--coverage.include=${COVERAGE_INCLUDE}`);
    expect(first).toHaveLength(9 + DEFAULT_COVERAGE_EXCLUDES.length);
    expect(result.outcome).toBe("scope");
  });

  it("adds the exclusions the project gives, and removes its temporary directories", async () => {
    const { exec, vitest } = spied();
    await diffScope({ cwd: added(), base: "main", exec, exclude: ["gen/**"] });
    const first = vitest[0] ?? [];
    expect(first).toContain("--coverage.exclude=gen/**");
    expect(first).toHaveLength(10 + DEFAULT_COVERAGE_EXCLUDES.length);
    const flag = first.find((arg) => arg.startsWith("--coverage.reportsDirectory=")) ?? "";
    const out = flag.slice("--coverage.reportsDirectory=".length);
    expect(basename(out).startsWith("wt-cov-")).toBe(true);
    expect(existsSync(out)).toBe(false);
  });

  it("asks git for the merge-base version of a modified test, and of no added one", async () => {
    const { exec, shows } = spied();
    await diffScope({ cwd: added(), base: "main", exec });
    expect(shows).toEqual([]);
    const dir = makeRepo({ "src/m.ts": M, "src/a.test.ts": TEST });
    git(dir, "switch", "-q", "-c", "work");
    write(dir, { "src/a.test.ts": `${TEST}f(3);\n`, "src/b.test.ts": TEST });
    commit(dir, "work");
    const second = spied();
    await diffScope({ cwd: dir, base: "main", exec: second.exec });
    expect(second.shows).toHaveLength(1);
    expect(second.shows[0]?.[1]).toMatch(/:src\/a\.test\.ts$/);
  });
});

describe("the merge-base copies", () => {
  it("are named before the extension for a test with no marker, after its last dot", async () => {
    const dir = makeRepo({ "src/m.ts": M, "src/__tests__/a.b.ts": TEST });
    git(dir, "switch", "-q", "-c", "work");
    write(dir, { "src/__tests__/a.b.ts": `${TEST}f(3);\n` });
    commit(dir, "work");
    const asked: string[] = [];
    await diffScope({
      copyToken: () => "tok",
      cwd: dir,
      base: "main",
      coverageOf: (file) => {
        asked.push(file);
        return Promise.resolve(ran(true, false));
      },
    });
    expect(asked).toEqual(["src/__tests__/a.b.ts", "src/__tests__/a.b.wt-base-tok.ts"]);
  });

  it("are removed even when the run took the copy away itself", async () => {
    const dir = makeRepo({ "src/m.ts": M, "src/a.test.ts": TEST });
    git(dir, "switch", "-q", "-c", "work");
    write(dir, { "src/a.test.ts": `${TEST}f(3);\n` });
    commit(dir, "work");
    const result = await diffScope({
      copyToken: () => "tok",
      cwd: dir,
      base: "main",
      coverageOf: (file) => {
        if (file.includes(".wt-base-")) rmSync(join(dir, file));
        return Promise.resolve(ran(true, false));
      },
    });
    expect(result.outcome).toBe("scope");
  });
});

describe("the ranges to mutate", () => {
  it("are not joined across two files, however close the last line of one and the first of the next", async () => {
    const lines = (n: number, mark: string): string =>
      `${Array.from({ length: n }, (_, at) => `export const v${String(at)}${mark} = ${String(at)};`).join("\n")}\n`;
    const dir = makeRepo({ "src/a.ts": lines(5, "a"), "src/b.ts": lines(8, "b") });
    git(dir, "switch", "-q", "-c", "work");
    const edit = (text: string, from: number, to: number): string =>
      text
        .split("\n")
        .map((line, at) => (at + 1 >= from && at + 1 <= to ? `${line} // edited` : line))
        .join("\n");
    write(dir, { "src/a.ts": edit(lines(5, "a"), 3, 5), "src/b.ts": edit(lines(8, "b"), 6, 8) });
    commit(dir, "work");
    const result = await diffScope({ cwd: dir, base: "main" });
    expect(result.outcome === "scope" ? result.scope.mutate : []).toEqual([
      "src/a.ts:3-5",
      "src/b.ts:6-8",
    ]);
  });
});
