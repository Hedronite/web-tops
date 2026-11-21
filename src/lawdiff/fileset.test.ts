import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { compareFileSets, readFileSets, type FileSetsRead } from "./fileset.ts";
import type { ProjectSets } from "./types.ts";

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../..");

function project(files: Record<string, string>): string {
  const dir = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  put(dir, files);
  return dir;
}

const projectsOf = (read: FileSetsRead): ReadonlyMap<string, ProjectSets> =>
  read.ok ? read.projects : new Map();

const messageOf = (read: FileSetsRead): string => (read.ok ? "" : read.message);

const must = (value: ProjectSets | undefined): ProjectSets => {
  if (value === undefined) throw new Error("no such project");
  return value;
};

describe("the file set of each checked project", () => {
  it("is its include, exclude, files and references as the config says them after extends, and its program", () => {
    const dir = project({
      "tsconfig.base.json":
        '{ "compilerOptions": { "strict": true }, "include": ["src"], "exclude": ["src/gen"] }',
      "tsconfig.json": '{ "extends": "./tsconfig.base.json", "references": [{ "path": "./sub" }] }',
      "sub/tsconfig.json": '{ "files": ["a.ts"] }',
      "src/x.ts": "export const x = 1;\n",
      "src/gen/y.ts": "export const y = 1;\n",
      "sub/a.ts": "export const a = 1;\n",
    });
    const projects = projectsOf(readFileSets(dir));
    expect([...projects.keys()]).toEqual(["tsconfig.json", "sub/tsconfig.json"]);
    const root = must(projects.get("tsconfig.json"));
    expect(root).toMatchObject({
      include: ["src"],
      exclude: ["src/gen"],
      files: [],
      references: ["sub/tsconfig.json"],
    });
    expect([...root.program]).toEqual(["src/x.ts"]);
    const sub = must(projects.get("sub/tsconfig.json"));
    expect(sub).toMatchObject({ include: [], files: ["a.ts"], references: [] });
    expect([...sub.program]).toEqual(["sub/a.ts"]);
  });

  it("reads a project reached twice once, and a solution config that selects nothing is not a problem", () => {
    const dir = project({
      "tsconfig.json": '{ "files": [], "references": [{ "path": "./a" }, { "path": "./a" }] }',
      "a/tsconfig.json": '{ "include": ["*.ts"] }',
      "a/x.ts": "export const x = 1;\n",
    });
    expect(projectsOf(readFileSets(dir)).size).toBe(2);
  });

  it("says why when there is no tsconfig, a config does not read, or TypeScript is not installed", () => {
    expect(readFileSets(tempDir())).toEqual({ ok: false, message: "tsconfig.json is missing" });
    expect(
      messageOf(readFileSets(project({ "tsconfig.json": '{ "extends": "./nope.json" }' }))),
    ).toContain("nope.json");
    const bare = tempDir();
    put(bare, { "tsconfig.json": "{}" });
    expect(messageOf(readFileSets(bare))).toContain("typescript is not installed");
  });

  it("names the project and what is wrong with a referenced project that does not read", () => {
    const dir = project({
      "tsconfig.json": '{ "files": [], "references": [{ "path": "./a" }] }',
      "a/tsconfig.json": '{ "extends": "./nope.json" }',
    });
    expect(messageOf(readFileSets(dir)).startsWith("a/tsconfig.json: ")).toBe(true);
  });
});

const sets = (over: Partial<ProjectSets> = {}, program: string[] = ["src/a.ts"]): ProjectSets => ({
  include: ["src"],
  exclude: [],
  files: [],
  references: [],
  ...over,
  program: new Set(program),
});

const diff = (
  base: Record<string, ProjectSets>,
  head: Record<string, ProjectSets>,
  tracked: string[] = ["src/a.ts"],
  renames = new Map<string, string>(),
) =>
  compareFileSets(new Map(Object.entries(base)), new Map(Object.entries(head)), renames, tracked);

describe("the file sets that moved", () => {
  it("weaken on an include or file entry removed, an exclude added and a reference removed", () => {
    const base = {
      "tsconfig.json": sets({
        include: ["src", "lib"],
        files: ["a.ts"],
        references: ["x/tsconfig.json"],
      }),
    };
    const head = {
      "tsconfig.json": sets({ include: ["src"], files: [], exclude: ["src/a.ts"], references: [] }),
    };
    expect(diff(base, head).items.map((item) => [item.what, item.change, item.where])).toEqual([
      ["tsconfig.json: include", "weakened", "lib"],
      ["tsconfig.json: files", "weakened", "a.ts"],
      ["tsconfig.json: exclude", "weakened", "src/a.ts"],
      ["tsconfig.json: references", "weakened", "x/tsconfig.json"],
    ]);
  });

  it("strengthen on an include added, an exclude dropped and a reference added", () => {
    const base = { "tsconfig.json": sets({ exclude: ["gen"] }) };
    const head = {
      "tsconfig.json": sets({ include: ["src", "lib"], references: ["x/tsconfig.json"] }),
    };
    expect(diff(base, head).items.map((item) => [item.what, item.change])).toEqual([
      ["tsconfig.json: include", "strengthened"],
      ["tsconfig.json: exclude", "strengthened"],
      ["tsconfig.json: references", "strengthened"],
    ]);
  });

  it("weaken on a project that is no longer checked, and on a tracked file the project no longer holds", () => {
    expect(diff({ "a/tsconfig.json": sets() }, {}).items).toEqual([
      {
        what: "tsconfig project a/tsconfig.json",
        change: "weakened",
        before: "checked",
        after: "no longer checked",
      },
    ]);
    const dropped = diff({ "tsconfig.json": sets() }, { "tsconfig.json": sets({}, []) });
    expect(dropped.items).toEqual([
      {
        what: "tsconfig.json: program",
        change: "weakened",
        before: "in the project",
        after: "no longer in the project",
        where: "src/a.ts",
      },
    ]);
  });

  it("do not weaken on a file the head no longer has, and follow a renamed file to its new path", () => {
    expect(diff({ "tsconfig.json": sets() }, { "tsconfig.json": sets({}, []) }, []).items).toEqual(
      [],
    );
    const renames = new Map([["src/b.ts", "src/a.ts"]]);
    const held = diff(
      { "tsconfig.json": sets() },
      { "tsconfig.json": sets({}, ["src/b.ts"]) },
      ["src/b.ts"],
      renames,
    );
    expect(held.items).toEqual([]);
    const lost = diff(
      { "tsconfig.json": sets() },
      { "tsconfig.json": sets({}, []) },
      ["src/b.ts"],
      renames,
    );
    expect(lost.items.map((item) => item.where)).toEqual(["src/b.ts"]);
  });

  it("count every entry and file of the base projects as compared", () => {
    const base = {
      "tsconfig.json": sets(
        { include: ["a", "b"], exclude: ["c"], files: ["d"], references: ["e"] },
        ["f", "g"],
      ),
    };
    expect(diff(base, base).compared).toBe(7);
    expect(diff({}, base).compared).toBe(0);
  });
});
