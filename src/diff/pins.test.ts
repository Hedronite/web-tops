import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Exec } from "../gate/types.ts";
import { COVERAGE_INCLUDE, DEFAULT_COVERAGE_EXCLUDES } from "../layers/coverage/scope.ts";
import { coveredSpans, parseCoverage } from "./coverage.ts";
import { functionsIn, innermostAt } from "./functions.ts";
import { mergeBaseOf } from "./git.ts";
import { diffScope, isSourceFile, isTestFile } from "./scope.ts";
import { cleanRepos, diffOf, FAKE_BASE, fakeGit, plainDir, write } from "./test-support.ts";
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
    const paths = (path: string): string[] => [...(parseCoverage({ [path]: file })?.keys() ?? [])];
    expect(paths("/work/a.ts")).toEqual(["/work/a.ts"]);
    expect(paths("Stryker was here/a.ts")).toEqual(["Stryker was here/a.ts"]);
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

  it("names a function only by a variable, property assignment or property declaration it initializes", () => {
    const text = "export function f(a = () => 1) {}\nconst { x = () => 2 } = o;\n";
    expect(functionsIn("a.ts", text).map((span) => span.key)).toEqual([
      "a.ts::<module>",
      "a.ts::f",
      "a.ts::f#1",
      "a.ts::<module>#1",
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

/** Git is the given fake; Vitest is a fake that keeps its arguments. */
function spied(git: Exec): { exec: Exec; vitest: string[][] } {
  const vitest: string[][] = [];
  const exec: Exec = (command, args, options) => {
    if (command === "git") return git(command, args, options);
    vitest.push([...args]);
    return Promise.resolve(fakeVitest(args));
  };
  return { exec, vitest };
}

describe("the default runs of Vitest", () => {
  const added = (): { cwd: string; git: Exec } => ({
    cwd: plainDir({ "src/m.ts": M, "src/a.test.ts": TEST, "src/b.test.ts": TEST }),
    git: fakeGit(
      diffOf([
        { path: "src/a.test.ts", kind: "added" },
        { path: "src/b.test.ts", kind: "added" },
      ]),
    ),
  });

  it("runs both files together first, then each alone where that fails, under the gate's own options", async () => {
    const project = added();
    const { exec, vitest } = spied(project.git);
    const result = await diffScope({ cwd: project.cwd, base: "main", exec });
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
    const project = added();
    const { exec, vitest } = spied(project.git);
    await diffScope({ cwd: project.cwd, base: "main", exec, exclude: ["gen/**"] });
    const first = vitest[0] ?? [];
    expect(first).toContain("--coverage.exclude=gen/**");
    expect(first).toHaveLength(10 + DEFAULT_COVERAGE_EXCLUDES.length);
    const flag = first.find((arg) => arg.startsWith("--coverage.reportsDirectory=")) ?? "";
    const out = flag.slice("--coverage.reportsDirectory=".length);
    expect(basename(out).startsWith("wt-cov-")).toBe(true);
    expect(existsSync(out)).toBe(false);
  });

  it("asks git for the merge-base version of a modified test, and of no added one", async () => {
    const seen: string[][] = [];
    const cwd = plainDir({ "src/m.ts": M, "src/a.test.ts": TEST, "src/b.test.ts": TEST });
    const diff = diffOf([
      { path: "src/a.test.ts", kind: "modified" },
      { path: "src/b.test.ts", kind: "added" },
    ]);
    const { exec } = spied(fakeGit(diff, { "src/a.test.ts": TEST }, seen));
    await diffScope({ cwd, base: "main", exec });
    const shows = seen.filter((args) => args[0] === "show");
    expect(shows).toEqual([["show", `${FAKE_BASE}:src/a.test.ts`]]);
  });
});

describe("the merge-base copies", () => {
  const modified = (path: string): { cwd: string; exec: Exec } => ({
    cwd: plainDir({ "src/m.ts": M, [path]: TEST }),
    exec: fakeGit(diffOf([{ path, kind: "modified" }]), { [path]: TEST }),
  });

  it("are named before the extension for a test with no marker, after its last dot", async () => {
    const asked: string[] = [];
    await diffScope({
      ...modified("src/__tests__/a.b.ts"),
      copyToken: () => "tok",
      base: "main",
      coverageOf: (file) => {
        asked.push(file);
        return Promise.resolve(ran(true, false));
      },
    });
    expect(asked).toEqual(["src/__tests__/a.b.ts", "src/__tests__/a.b.wt-base-tok.ts"]);
  });

  it("are removed even when the run took the copy away itself", async () => {
    const project = modified("src/a.test.ts");
    const result = await diffScope({
      ...project,
      copyToken: () => "tok",
      base: "main",
      coverageOf: (file) => {
        if (file.includes(".wt-base-")) rmSync(join(project.cwd, file));
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
    const cwd = plainDir({ "src/a.ts": lines(5, "a"), "src/b.ts": lines(8, "b") });
    const exec = fakeGit(
      diffOf([
        { path: "src/a.ts", kind: "modified", range: [3, 5] },
        { path: "src/b.ts", kind: "modified", range: [6, 8] },
      ]),
    );
    const result = await diffScope({ cwd, base: "main", exec });
    expect(result.outcome === "scope" ? result.scope.mutate : []).toEqual([
      "src/a.ts:3-5",
      "src/b.ts:6-8",
    ]);
  });
});
