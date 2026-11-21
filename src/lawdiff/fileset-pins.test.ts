import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { readFileSets, type FileSetsRead } from "./fileset.ts";

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../..");

function project(files: Record<string, string>): string {
  const dir = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  put(dir, files);
  return dir;
}

const messageOf = (read: FileSetsRead): string => (read.ok ? "" : read.message);

const keysOf = (read: FileSetsRead): string[] => (read.ok ? [...read.projects.keys()] : []);

describe("the file set of projects that reference each other", () => {
  it("is read once for each, however the references run in a circle or back to themselves", () => {
    const dir = project({
      "tsconfig.json":
        '{ "include": [], "references": [{ "path": "./a" }, { "path": "./tsconfig.json" }] }',
      "a/tsconfig.json": '{ "include": [], "references": [{ "path": "../tsconfig.json" }] }',
    });
    const read = readFileSets(dir);
    expect(messageOf(read)).not.toContain("call stack");
    expect(keysOf(read)).toEqual(["tsconfig.json", "a/tsconfig.json"]);
  });

  it("is the first problem of any referenced project, not only of the first one", () => {
    const dir = project({
      "tsconfig.json":
        '{ "include": [], "references": [{ "path": "./good" }, { "path": "./bad" }] }',
      "good/tsconfig.json": '{ "include": [] }',
      "bad/tsconfig.json": '{ "extends": "./nope.json" }',
    });
    expect(messageOf(readFileSets(dir)).startsWith("bad/tsconfig.json: ")).toBe(true);
  });
});

describe("a config with several problems", () => {
  it("names each, one after another with a semicolon, behind the project's name", () => {
    const dir = project({
      "tsconfig.json":
        '{ "compilerOptions": { "target": "bogus", "module": "nonsense" }, "include": ["src"] }',
    });
    const message = messageOf(readFileSets(dir));
    expect(message.startsWith("tsconfig.json: Argument for '--target' option")).toBe(true);
    expect(message).toContain(".; Argument for '--module' option");
  });
});

describe("a config that sets only an include", () => {
  it("holds no exclude, no files and no references", () => {
    const dir = project({
      "tsconfig.json": '{ "include": ["src"] }',
      "src/a.ts": "export const a = 1;\n",
    });
    const read = readFileSets(dir);
    const root = read.ok ? read.projects.get("tsconfig.json") : undefined;
    expect(root).toMatchObject({ include: ["src"], exclude: [], files: [], references: [] });
  });
});
