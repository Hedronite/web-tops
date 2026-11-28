import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cfg } from "../../gate/testkit.ts";
import { cleanTemp, put, tempDir } from "../probe/testkit.ts";
import { tscReader } from "./tsc.ts";
import type { LawEntry, LawReading } from "./types.ts";

/** W-04's compiler file set leaves out an example that gates itself, and nothing else (WEB_TOPS.md section 6.5). */

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../../..");
const LEFT = "left out of the file set, as examples that gate themselves (section 6.5): ";

const law = (id: string, flag: string): LawEntry => ({
  id,
  severity: "R",
  reader: "an",
  classes: [],
  judged: true,
  rules: [{ tool: "tsc", name: flag }],
});

const CONFIG = '{\n  "compilerOptions": { "strict": true },\n  "include": ["src/a.ts"]\n}\n';
const SOURCE = "export const x = 1;\n";

interface Given {
  /** The tracked files; `src/a.ts` is always one, and the one the project holds. */
  readonly tracked: readonly string[];
  /** Files that lie in the work tree and are not tracked. */
  readonly untracked: readonly string[];
  readonly diagnostics: readonly object[];
  readonly held: boolean;
  readonly entry: LawEntry;
}

const DEFAULTS: Given = {
  tracked: [],
  untracked: [],
  diagnostics: [],
  held: false,
  entry: law("W-04", "strict"),
};

function project(given: Given, tracked: readonly string[]): string {
  const cwd = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
  const written = [...tracked, ...given.untracked].map((file): [string, string] => [file, SOURCE]);
  put(cwd, {
    ...Object.fromEntries(written),
    "tsconfig.json": CONFIG,
    "out/tsc.json": JSON.stringify(given.diagnostics),
  });
  return cwd;
}

async function read(options: Partial<Given>): Promise<LawReading | undefined> {
  const given = { ...DEFAULTS, ...options };
  const tracked = ["src/a.ts", ...given.tracked];
  const cwd = project(given, tracked);
  const [reading] = await tscReader({
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
    laws: [given.entry],
    tracked,
    held: given.held,
    eslint: () => Promise.reject(new Error("the compiler reader never asks ESLint")),
  });
  return reading;
}

const refused = (reading: LawReading | undefined): unknown[] =>
  (reading?.findings ?? []).filter((found) => found.rule === "file-set").map((found) => found.file);

describe("W-04 over a tree with examples", () => {
  it("leaves out each example that tracks its own web-tops.yaml, and names them once, in order", async () => {
    const reading = await read({
      tracked: [
        "examples/web/web-tops.yaml",
        "examples/web/src/a.ts",
        "examples/web/src/b.ts",
        "examples/api/web-tops.yaml",
        "examples/api/src/c.ts",
      ],
    });
    expect(reading).toEqual({
      law: "W-04",
      verdict: "pass",
      findings: [],
      note: `${LEFT}examples/api, examples/web`,
    });
  });

  it.each([
    ["src/x/", ["src/x/web-tops.yaml", "src/x/y.ts"]],
    ["packages/x/", ["packages/x/web-tops.yaml", "packages/x/y.ts"]],
    ["examples/a/b/", ["examples/a/b/web-tops.yaml", "examples/a/b/y.ts"]],
  ])("exempts nothing for a web-tops.yaml under %s", async (_where, tracked) => {
    const reading = await read({ tracked });
    expect(reading?.verdict).toBe("refuse");
    expect(refused(reading)).toEqual([tracked[1]]);
    expect(reading).not.toHaveProperty("note");
  });

  it("refuses an example whose web-tops.yaml is not tracked", async () => {
    const reading = await read({
      tracked: ["examples/loose/src/a.ts"],
      untracked: ["examples/loose/web-tops.yaml"],
    });
    expect(reading?.verdict).toBe("refuse");
    expect(refused(reading)).toEqual(["examples/loose/src/a.ts"]);
  });

  it("still holds the root project to its own files beside an example it leaves out", async () => {
    const reading = await read({
      tracked: ["web-tops.yaml", "scripts/x.ts", "examples/web/web-tops.yaml", "examples/web/y.ts"],
    });
    expect(reading?.verdict).toBe("refuse");
    expect(refused(reading)).toEqual(["scripts/x.ts"]);
    expect(reading?.note).toBe(`${LEFT}examples/web`);
  });

  it("says both what gate 1 raised under a held ratchet and what it left out", async () => {
    const reading = await read({
      tracked: ["examples/web/web-tops.yaml", "examples/web/y.ts"],
      diagnostics: [{ file: "src/a.ts", line: 1, column: 1, code: "TS7006", message: "m" }],
      held: true,
    });
    expect(reading?.note).toMatch(
      new RegExp(`held by the baseline; left out .*: examples/web$`, "u"),
    );
  });

  it("says nothing of examples for a law that judges no file set", async () => {
    const reading = await read({
      tracked: ["examples/web/web-tops.yaml", "examples/web/y.ts"],
      entry: law("W-01", "noImplicitAny"),
    });
    expect(reading).toEqual({ law: "W-01", verdict: "pass", findings: [] });
  });
});
