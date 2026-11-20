import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import type { LawEntry, ReadInput } from "./types.ts";
import { cleanTemp, put, tempDir } from "../probe/testkit.ts";
import { tscReader } from "./tsc.ts";

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../../..");

const W04: LawEntry = {
  id: "W-04",
  severity: "R",
  reader: "an",
  classes: [],
  judged: true,
  rules: [
    { tool: "tsc", name: "strict" },
    { tool: "tsc", name: "noUncheckedIndexedAccess" },
  ],
};

const W01: LawEntry = {
  id: "W-01",
  severity: "R",
  reader: "tl",
  classes: [],
  judged: true,
  rules: [{ tool: "tsc", name: "noImplicitAny" }],
};

function project(files: Record<string, string>): string {
  const cwd = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
  put(cwd, { "out/tsc.json": "[]\n", ...files });
  return cwd;
}

/** What the reader is given: the tracked files, and the artifact of gate 1 when the project wrote one. */
function input(cwd: string, tracked: string[], extra: Partial<ReadInput> = {}): ReadInput {
  return {
    ctx: {
      cwd,
      config: cfg(),
      base: "origin/main",
      enforce: "hard",
      env: {},
      exec: () => Promise.reject(new Error("the reader never runs a tool")),
      outDir: join(cwd, ".web-tops", "out"),
      artifacts: new Map([["tsc-diagnostics", join(cwd, "out/tsc.json")]]),
    },
    laws: [W04],
    tracked,
    held: false,
    eslint: () => Promise.reject(new Error("the compiler reader never asks ESLint")),
    ...extra,
  };
}

const GOOD =
  '{\n  "compilerOptions": {\n    "strict": true,\n    "noUncheckedIndexedAccess": true\n  },\n  "include": ["src"]\n}\n';

const diagnostic = (code: string): Record<string, unknown> => ({
  file: "src/a.ts",
  line: 1,
  column: 1,
  code,
  message: "m",
});

describe("G4b the tsc reader judges the projects' flags and the tracked files no project holds", () => {
  it("passes a project with the flags set and every tracked source file in its program", async () => {
    const cwd = project({ "tsconfig.json": GOOD, "src/a.ts": "export const a = 1;\n" });
    const readings = await tscReader(input(cwd, ["src/a.ts", "README.md"]));
    expect(readings).toEqual([{ law: "W-04", verdict: "pass", findings: [] }]);
  });

  it("refuses a tracked source file in no project, with its file", async () => {
    const cwd = project({
      "tsconfig.json": GOOD,
      "src/a.ts": "export const a = 1;\n",
      "scripts/x.ts": "export const x = 1;\n",
    });
    const [reading] = await tscReader(input(cwd, ["src/a.ts", "scripts/x.ts"]));
    expect(reading?.verdict).toBe("refuse");
    expect(reading?.findings.map((found) => [found.rule, found.file])).toEqual([
      ["file-set", "scripts/x.ts"],
    ]);
  });

  it("the data trees of section 17, fixtures and probes, are not orphans", async () => {
    const cwd = project({ "tsconfig.json": GOOD, "src/a.ts": "export const a = 1;\n" });
    const tracked = ["src/a.ts", "fixtures/laws/W-01/bad/x.ts", "probes/w22/y.tsx"];
    const [reading] = await tscReader(input(cwd, tracked));
    expect(reading?.verdict).toBe("pass");
  });

  it("a nested tsconfig that no reference reaches is not a checked project: its files are orphans", async () => {
    const cwd = project({
      "tsconfig.json": GOOD,
      "src/a.ts": "export const a = 1;\n",
      "examples/n/tsconfig.json": GOOD.replace('"src"', '"."'),
      "examples/n/b.ts": "export const b = 1;\n",
    });
    const [reading] = await tscReader(input(cwd, ["src/a.ts", "examples/n/b.ts"]));
    expect(reading?.findings.map((found) => found.file)).toEqual(["examples/n/b.ts"]);
  });

  it("an absent flag refuses at the top of compilerOptions, and a false member at its own line", async () => {
    const config =
      '{\n  "compilerOptions": {\n    "strict": true,\n    "strictNullChecks": false\n  },\n  "include": ["src"]\n}\n';
    const cwd = project({ "tsconfig.json": config, "src/a.ts": "export const a = 1;\n" });
    const [reading] = await tscReader(input(cwd, ["src/a.ts"]));
    expect(reading?.findings.map((found) => [found.message, found.line])).toEqual([
      ["strictNullChecks is false (tsconfig.json)", 4],
      ["noUncheckedIndexedAccess is not set (tsconfig.json)", 2],
    ]);
  });

  it("a missing tsconfig fails the law with the reason, and a config it cannot resolve does too", async () => {
    const [missing] = await tscReader(input(project({}), []));
    expect(missing).toEqual({
      law: "W-04",
      verdict: "fail",
      reason: "tsconfig.json is missing: no compiler flag is set",
      findings: [],
    });
    const dangling = project({ "tsconfig.json": '{ "extends": "./nowhere.json" }\n' });
    const [broken] = await tscReader(input(dangling, []));
    expect(broken?.verdict).toBe("fail");
  });
});

describe("G4b a live flag with a failing diagnostic is refuse, never a pass", () => {
  const cwd = (): string =>
    project({
      "tsconfig.json": '{\n  "compilerOptions": { "strict": true },\n  "include": ["src"]\n}\n',
      "src/a.ts": "export const a = 1;\n",
      "out/bad.json": JSON.stringify([
        diagnostic("TS7006"),
        diagnostic("TS7006"),
        diagnostic("TS2322"),
      ]),
      "out/text.json": "not json",
    });

  const withArtifact = (dir: string, name: string, extra: Partial<ReadInput> = {}): ReadInput => {
    const base = input(dir, ["src/a.ts"], { laws: [W01], ...extra });
    const artifacts = new Map([["tsc-diagnostics", join(dir, "out", name)]]);
    return { ...base, ctx: { ...base.ctx, artifacts } };
  };

  it("a TS7006 under noImplicitAny refuses W-01, noted by code and count; the shared TS2322 maps to no law", async () => {
    const dir = cwd();
    const [reading] = await tscReader(withArtifact(dir, "bad.json"));
    expect(reading).toEqual({ law: "W-01", verdict: "refuse", findings: [], note: "TS7006 2" });
  });

  it("the ratchet holds the count: a pass with the note, as for ESLint findings", async () => {
    const dir = cwd();
    const [reading] = await tscReader(withArtifact(dir, "bad.json", { held: true }));
    expect(reading).toEqual({
      law: "W-01",
      verdict: "pass",
      findings: [],
      note: "TS7006 2 held by the baseline",
    });
  });

  it("an artifact that is missing or is not diagnostics fails the law, never reads as clean", async () => {
    const dir = cwd();
    const [unreadable] = await tscReader(withArtifact(dir, "text.json"));
    expect(unreadable?.verdict).toBe("fail");
    expect(unreadable?.reason).toContain("tsc diagnostics of gate 1");
    const bare = input(dir, ["src/a.ts"], { laws: [W01] });
    const none = { ...bare, ctx: { ...bare.ctx, artifacts: new Map<string, string>() } };
    const [absent] = await tscReader(none);
    expect(absent?.verdict).toBe("fail");
  });
});
