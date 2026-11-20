import { realpathSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../probe/testkit.ts";
import { readProjects } from "./tsc-projects.ts";
import type { Project } from "./tsc-judge.ts";

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../../..");

/** A project whose `node_modules` is the kit's, so the TypeScript is a real one, with the given files. */
function project(files: Record<string, string>): string {
  const cwd = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
  put(cwd, files);
  return cwd;
}

/** The first project of a read, or a failure with its own message. */
function first(cwd: string): Project {
  const one = projects(cwd).projects[0];
  if (one === undefined) {
    throw new Error("no project was read");
  }
  return one;
}

function projects(cwd: string): ReturnType<typeof readProjects> & { ok: true } {
  const read = readProjects(cwd);
  if (!read.ok) {
    throw new Error(read.message);
  }
  return read;
}

describe("G4b the tsc reader reads each project through its extends chain, with the project's TypeScript", () => {
  it("resolves a flag the project sets, with its line, and leaves a default unfilled", () => {
    const cwd = project({
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "strict": true,\n    "noEmit": true\n  },\n  "include": ["src"]\n}\n',
      "src/a.ts": "export const a = 1;\n",
    });
    const only = first(cwd);
    expect(only.config).toBe("tsconfig.json");
    expect(only.options["strict"]).toBe(true);
    expect(only.options["noUncheckedIndexedAccess"]).toBeUndefined();
    expect(only.spots.get("strict")).toEqual({ file: "tsconfig.json", line: 3 });
    expect(only.section).toEqual({ file: "tsconfig.json", line: 2 });
    expect(only.files).toBe(1);
    expect([...only.program]).toEqual(["src/a.ts"]);
  });

  it("reads through extends: the flag is set in the base, and strict true beside a member false in the child is seen", () => {
    const cwd = project({
      "tsconfig.base.json":
        '{\n  "compilerOptions": {\n    "strict": true,\n    "noEmit": true\n  }\n}\n',
      "tsconfig.json":
        '{\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": {\n    "strictNullChecks": false\n  },\n  "include": ["src"]\n}\n',
      "src/a.ts": "export const a = 1;\n",
    });
    const only = first(cwd);
    expect(only.options["strict"]).toBe(true);
    expect(only.options["strictNullChecks"]).toBe(false);
    expect(only.spots.get("strict")).toEqual({ file: "tsconfig.base.json", line: 3 });
    expect(only.spots.get("strictNullChecks")).toEqual({ file: "tsconfig.json", line: 4 });
    expect(only.section).toEqual({ file: "tsconfig.json", line: 3 });
  });

  it("a child that overrides the base's value is where the flag is set", () => {
    const cwd = project({
      "base.json": '{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n',
      "tsconfig.json":
        '{\n  "extends": "./base.json",\n  "compilerOptions": { "strict": false },\n  "include": ["a.ts"]\n}\n',
      "a.ts": "export const a = 1;\n",
    });
    const only = first(cwd);
    expect(only.options["strict"]).toBe(false);
    expect(only.spots.get("strict")).toEqual({ file: "tsconfig.json", line: 3 });
  });

  it("follows references: a solution config has no files, and each referenced project is read", () => {
    const cwd = project({
      "tsconfig.json":
        '{\n  "files": [],\n  "references": [{ "path": "./app" }, { "path": "./test" }]\n}\n',
      "app/tsconfig.json":
        '{\n  "compilerOptions": { "strict": true, "composite": true, "noEmit": false },\n  "include": ["."]\n}\n',
      "app/a.ts": "export const a = 1;\n",
      "test/tsconfig.json":
        '{\n  "compilerOptions": { "composite": true, "noEmit": false },\n  "include": ["."],\n  "references": [{ "path": "../app" }]\n}\n',
      "test/b.ts": "export const b = 1;\n",
    });
    const read = projects(cwd).projects;
    expect(read.map((one) => [one.config, one.files])).toEqual([
      ["tsconfig.json", 0],
      [join("app", "tsconfig.json"), 1],
      [join("test", "tsconfig.json"), 1],
    ]);
    expect([...(read[1]?.program ?? [])]).toEqual([join("app", "a.ts")]);
  });

  it("holds a file an included file imports, though the exclude names it", () => {
    const cwd = project({
      "tsconfig.json":
        '{\n  "compilerOptions": { "strict": true },\n  "include": ["src"],\n  "exclude": ["src/lib"]\n}\n',
      "src/a.ts": 'import { b } from "./lib/b.ts";\nexport const a = b;\n',
      "src/lib/b.ts": "export const b = 1;\n",
      "src/lib/c.ts": "export const c = 1;\n",
    });
    const only = first(cwd);
    expect([...only.program].sort()).toEqual([join("src", "a.ts"), join("src", "lib", "b.ts")]);
  });

  it("a missing tsconfig, a config that cannot be read, and a missing extends are problems with a message", () => {
    expect(readProjects(project({}))).toEqual({
      ok: false,
      message: "tsconfig.json is missing: no compiler flag is set",
    });
    const dangling = project({ "tsconfig.json": '{ "extends": "./nowhere.json" }\n' });
    const read = readProjects(dangling);
    expect(!read.ok && read.message).toContain("tsconfig.json: ");
    const bare = tempDir();
    put(bare, { "tsconfig.json": "{}\n" });
    const noTypescript = readProjects(bare);
    expect(!noTypescript.ok && noTypescript.message).toContain("typescript is not installed");
  });

  it("a config that selects no file is a project with no files, not a problem", () => {
    const cwd = project({
      "tsconfig.json": '{ "compilerOptions": { "strict": true }, "include": ["nothing"] }\n',
    });
    const only = first(cwd);
    expect(only.files).toBe(0);
    expect(only.options["strict"]).toBe(true);
  });

  it("holds only the project's own files: not a package of node_modules, not a file outside the project", () => {
    const outer = tempDir();
    const cwd = join(outer, "proj");
    put(outer, { "shared.ts": "export const shared = 1;\n" });
    put(cwd, {
      "tsconfig.json":
        '{ "compilerOptions": { "allowImportingTsExtensions": true, "noEmit": true, "types": [] }, "include": ["src"] }\n',
      "src/a.ts":
        'import type {} from "typescript";\nimport { shared } from "../../shared.ts";\nexport const a = shared;\n',
    });
    symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
    expect([...first(cwd).program]).toEqual([join("src", "a.ts")]);
  });

  it("a project the root references that cannot be read is the problem, named by its own config", () => {
    const cwd = project({
      "tsconfig.json": '{ "files": [], "references": [{ "path": "./bad" }] }\n',
      "bad/tsconfig.json": '{ "extends": "./nowhere.json" }\n',
    });
    const read = readProjects(cwd);
    expect(!read.ok && read.message).toContain(join("bad", "tsconfig.json"));
  });

  it("every error of one config is said, apart by a semicolon", () => {
    const cwd = project({
      "tsconfig.json":
        '{ "compilerOptions": { "target": "nope", "module": "nope" }, "include": ["src"] }\n',
      "src/a.ts": "export const a = 1;\n",
    });
    const read = readProjects(cwd);
    expect(!read.ok && read.message.startsWith("tsconfig.json: ")).toBe(true);
    expect(!read.ok && read.message.split("; ").length).toBe(2);
  });

  it("leaves out a package under the project's own node_modules, by its path", () => {
    const cwd = realpathSync(tempDir());
    put(cwd, {
      "tsconfig.json":
        '{ "compilerOptions": { "moduleResolution": "bundler", "module": "preserve", "types": [] }, "include": ["src"] }\n',
      "src/a.ts": 'import type { Thing } from "pkg";\nexport type A = Thing;\n',
      "node_modules/pkg/package.json": '{ "name": "pkg", "types": "index.d.ts" }\n',
      "node_modules/pkg/index.d.ts": "export type Thing = number;\n",
    });
    symlinkSync(join(REPO, "node_modules", "typescript"), join(cwd, "node_modules", "typescript"));
    expect([...first(cwd).program]).toEqual([join("src", "a.ts")]);
  });

  it("a referenced project that cannot be read is the problem even when an earlier one was fine", () => {
    const cwd = project({
      "tsconfig.json":
        '{ "files": [], "references": [{ "path": "./good" }, { "path": "./bad" }] }\n',
      "good/tsconfig.json": '{ "compilerOptions": { "composite": true }, "include": ["."] }\n',
      "good/a.ts": "export const a = 1;\n",
      "bad/tsconfig.json": '{ "extends": "./nowhere.json" }\n',
    });
    const read = readProjects(cwd);
    expect(read.ok).toBe(false);
    expect(!read.ok && read.message).toContain(join("bad", "tsconfig.json"));
  });
});
