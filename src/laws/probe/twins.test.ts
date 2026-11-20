import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "./testkit.ts";
import {
  isAstro,
  isCss,
  isScript,
  listTwins,
  materialize,
  splitTwins,
  stylelintIgnore,
} from "./twins.ts";
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
    "W-02/bad/style.css": "a { color: red; }\n",
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
      "W-02 bad W-02/bad/style.css",
      "W-02 clean W-02/clean/d.cts",
    ]);
  });

  it("lists an Astro file as a twin, and tells the kinds of file apart", () => {
    const dir = tempDir();
    put(dir, { "W-01/bad/page.astro": "<p />\n", "W-01/clean/page.astro": "<p />\n" });
    expect(listTwins(dir, LAWS).map((twin) => twin.file)).toEqual([
      "W-01/bad/page.astro",
      "W-01/clean/page.astro",
    ]);
    expect([isAstro("a.astro"), isAstro("a.ts"), isCss("a.css"), isCss("a.astro")]).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(["a.ts", "a.tsx", "a.mts", "a.cts"].every(isScript)).toBe(true);
    expect(isScript("a.astro") || isScript("a.css")).toBe(false);
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

  it("writes an empty ignore file for Stylelint beside the tsconfig", () => {
    const scratch = join(tempDir(), "scratch");
    materialize(fixtures(), scratch, LAWS, "/project/tsconfig.json");
    expect(readFileSync(join(scratch, stylelintIgnore()), "utf8")).toBe("");
    expect(stylelintIgnore()).toBe("stylelint.ignore");
  });

  it("writes the tsconfig both tools find: it extends the project's, names every file and excludes none", () => {
    const scratch = join(tempDir(), "scratch");
    materialize(fixtures(), scratch, LAWS, "/project/tsconfig.json");
    const config: unknown = JSON.parse(readFileSync(join(scratch, "tsconfig.json"), "utf8"));
    expect(config).toEqual({
      extends: "/project/tsconfig.json",
      compilerOptions: { noEmit: true },
      include: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/*.astro"],
      exclude: [],
    });
  });
});

describe("G3a twins: the files a twin has", () => {
  it("a file that only contains an extension is not a twin: a backup, a map, a text copy", () => {
    const dir = tempDir();
    put(dir, {
      "W-01/bad/a.ts": "export const a = 1;\n",
      "W-01/bad/a.ts.bak": "x\n",
      "W-01/bad/s.css.map": "x\n",
      "W-01/bad/p.astro.txt": "x\n",
      "W-01/bad/b.tsx.orig": "x\n",
    });
    expect(listTwins(dir, LAWS).map((found) => found.file)).toEqual(["W-01/bad/a.ts"]);
    expect([isScript("a.ts.bak"), isScript("a.tsx.map"), isScript("a.mts")]).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe("R105 twins: the Astro twins a class's preset cannot lint are skipped, with a reason", () => {
  const TWINS = [
    { law: "W-22", kind: "bad" as const, file: "W-22/bad/a.tsx" },
    { law: "W-22", kind: "bad" as const, file: "W-22/bad/a.astro" },
    { law: "W-22", kind: "clean" as const, file: "W-22/clean/a.astro" },
    { law: "W-26", kind: "bad" as const, file: "W-26/bad/s.css" },
  ];

  it("keeps every twin when the preset lints Astro", () => {
    expect(splitTwins(TWINS, undefined)).toEqual({ kept: TWINS, skipped: [] });
  });

  it("skips each Astro twin, and only those, with the reason beside it", () => {
    const { kept, skipped } = splitTwins(TWINS, "no astro here");
    expect(kept.map((twin) => twin.file)).toEqual(["W-22/bad/a.tsx", "W-26/bad/s.css"]);
    expect(skipped).toEqual([
      { law: "W-22", kind: "bad", file: "W-22/bad/a.astro", reason: "no astro here" },
      { law: "W-22", kind: "clean", file: "W-22/clean/a.astro", reason: "no astro here" },
    ]);
  });

  it("an empty reason still skips: only an absent one keeps the twins", () => {
    expect(splitTwins(TWINS, "").skipped).toHaveLength(2);
  });
});
