import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "./testkit.ts";
import { listTwins, materialize } from "./twins.ts";
import type { ProbeLaw } from "./types.ts";

afterAll(cleanTemp);

const LAWS: readonly ProbeLaw[] = [
  { id: "W-01", proofs: [] },
  { id: "W-02", proofs: [] },
];

function fixtures(): string {
  const dir = tempDir();
  put(dir, {
    "W-01/bad/a.ts": "export const a = 1;\n",
    "W-01/bad/nested/b.tsx": "export const b = 1;\n",
    "W-01/bad/_support.ts": "export const s = 1;\n",
    "W-01/bad/notes.md": "not a source file\n",
    "W-01/clean/c.mts": "export const c = 1;\n",
    "W-02/clean/d.cts": "export const d = 1;\n",
    "W-03/bad/e.ts": "export const e = 1;\n",
    "README.md": "fixtures\n",
  });
  return dir;
}

describe("G3a twins: fixtures/laws/W-NN/{bad,clean}/", () => {
  it("lists the source files of each given law, by kind, with the paths the markers and findings use", () => {
    const twins = listTwins(fixtures(), LAWS);
    expect(twins.map((twin) => `${twin.law} ${twin.kind} ${twin.file}`).sort()).toEqual([
      "W-01 bad W-01/bad/_support.ts",
      "W-01 bad W-01/bad/a.ts",
      "W-01 bad W-01/bad/nested/b.tsx",
      "W-01 clean W-01/clean/c.mts",
      "W-02 clean W-02/clean/d.cts",
    ]);
  });

  it("reads only the laws it is given: another law's directory is not a twin", () => {
    expect(listTwins(fixtures(), [])).toEqual([]);
    expect(listTwins(fixtures(), [{ id: "W-03", proofs: [] }])).toHaveLength(1);
  });

  it("a law with no directory has no twins, and so does a missing fixtures root", () => {
    expect(listTwins(fixtures(), [{ id: "W-99", proofs: [] }])).toEqual([]);
    expect(listTwins(join(tempDir(), "absent"), LAWS)).toEqual([]);
  });

  it("copies each probed law's directory, notes included, and no other law's", () => {
    const scratch = join(tempDir(), "scratch");
    materialize(fixtures(), scratch, LAWS, "/project/tsconfig.json");
    expect(existsSync(join(scratch, "W-01/bad/nested/b.tsx"))).toBe(true);
    expect(existsSync(join(scratch, "W-01/bad/notes.md"))).toBe(true);
    expect(existsSync(join(scratch, "W-02/clean/d.cts"))).toBe(true);
    expect(existsSync(join(scratch, "W-03"))).toBe(false);
    expect(existsSync(join(scratch, "README.md"))).toBe(false);
  });

  it("skips a law that has no directory, and clears what an earlier probe left", () => {
    const scratch = join(tempDir(), "scratch");
    put(scratch, { "stale/old.ts": "old\n" });
    materialize(fixtures(), scratch, [...LAWS, { id: "W-99", proofs: [] }], "/p/tsconfig.json");
    expect(existsSync(join(scratch, "stale"))).toBe(false);
    expect(existsSync(join(scratch, "W-99"))).toBe(false);
  });

  it("writes the tsconfig both tools find: it extends the project's, names every file and excludes none", () => {
    const scratch = join(tempDir(), "scratch");
    materialize(fixtures(), scratch, LAWS, "/project/tsconfig.json");
    const config: unknown = JSON.parse(readFileSync(join(scratch, "tsconfig.json"), "utf8"));
    expect(config).toEqual({
      extends: "/project/tsconfig.json",
      compilerOptions: { noEmit: true },
      include: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
      exclude: [],
    });
  });
});
