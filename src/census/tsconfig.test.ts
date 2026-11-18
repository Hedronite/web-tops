import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { tsconfigHits } from "./tsconfig.ts";

const root = resolve(import.meta.dirname, "../..");
const probe = join(root, "fixtures/probe");
const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A project under the repo's ignored `tmp/`, so the project's own TypeScript resolves from the kit's `node_modules`. */
function project(files: Readonly<Record<string, string>>): string {
  mkdirSync(join(root, "tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, "tmp", "wt-census-ts-"));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const files = (cwd: string, tracked: readonly string[]): string[] => {
  const read = tsconfigHits(cwd, new Set(tracked));
  return read.ok ? read.hits.map((hit) => hit.file) : [`FAILED: ${read.message}`];
};

describe("tsconfigHits (WEB_TOPS.md 6.7: tsconfig-exclude)", () => {
  it(
    "counts the tracked file the probe's exclude leaves out of the program, as the recorded tsc --listFilesOnly does",
    () => {
      expect(
        files(join(probe, "census-tsconfig-exclude"), ["src/ok.ts", "src/generated/g.ts"]),
      ).toEqual(["src/generated/g.ts"]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it("is empty when there is no tsconfig.json", () => {
    expect(files(project({ "src/a.ts": "export const a = 1;\n" }), ["src/a.ts"])).toEqual([]);
  });

  it(
    "counts nothing when exclude leaves nothing out, and when there is no exclude",
    () => {
      const dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { noEmit: true, types: [] },
          include: ["src"],
        }),
        "src/a.ts": "export const a = 1;\n",
        "src/b.ts": "export const b = 2;\n",
      });
      expect(files(dir, ["src/a.ts", "src/b.ts"])).toEqual([]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "does not count an excluded file that an included file imports: it is in the program",
    () => {
      const dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { noEmit: true, types: [], allowImportingTsExtensions: true },
          include: ["src"],
          exclude: ["src/gen/**"],
        }),
        "src/a.ts": 'import { g } from "./gen/g.ts";\nexport const a = g;\n',
        "src/gen/g.ts": "export const g = 1;\n",
        "src/gen/h.ts": "export const h = 2;\n",
      });
      expect(files(dir, ["src/a.ts", "src/gen/g.ts", "src/gen/h.ts"])).toEqual(["src/gen/h.ts"]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "counts only the files that are tracked, in file order",
    () => {
      const dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { noEmit: true, types: [] },
          include: ["src"],
          exclude: ["src/old/**"],
        }),
        "src/a.ts": "export const a = 1;\n",
        "src/old/z.ts": "export const z = 1;\n",
        "src/old/b.ts": "export const b = 1;\n",
        "src/old/untracked.ts": "export const u = 1;\n",
      });
      expect(files(dir, ["src/a.ts", "src/old/z.ts", "src/old/b.ts"])).toEqual([
        "src/old/b.ts",
        "src/old/z.ts",
      ]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "follows `extends`: an exclude in the parent config counts",
    () => {
      const dir = project({
        "tsconfig.base.json": JSON.stringify({
          compilerOptions: { noEmit: true, types: [] },
          exclude: ["src/skip/**"],
        }),
        "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json", include: ["src"] }),
        "src/a.ts": "export const a = 1;\n",
        "src/skip/s.ts": "export const s = 1;\n",
      });
      expect(files(dir, ["src/a.ts", "src/skip/s.ts"])).toEqual(["src/skip/s.ts"]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "reads a tsconfig.json that has comments",
    () => {
      const dir = project({
        "tsconfig.json":
          '{\n  // a comment\n  "compilerOptions": { "noEmit": true, "types": [] },\n  "include": ["src"],\n  "exclude": ["src/gen/**"]\n}\n',
        "src/a.ts": "export const a = 1;\n",
        "src/gen/g.ts": "export const g = 1;\n",
      });
      expect(files(dir, ["src/a.ts", "src/gen/g.ts"])).toEqual(["src/gen/g.ts"]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it("is `ok: false`, saying why, for a tsconfig.json that is not JSON", () => {
    const dir = project({ "tsconfig.json": "{ nope" });
    expect(files(dir, [])[0]).toMatch(/^FAILED: /);
  });

  it("is `ok: false` where the project has no TypeScript of its own", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-census-nots-"));
    made.push(dir);
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    expect(files(dir, [])[0]).toMatch(/^FAILED: .*typescript/);
  });
});
