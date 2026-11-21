import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cfg, noExec } from "../../gate/testkit.ts";
import { tsc } from "./build.ts";
import type { StepContext } from "./tooling.ts";

// tsc refuses a referenced project whose emit is off (TS6310), and `--noEmit` turns it off for the whole
// build: the step builds a root that has `references`, and checks any other root with `--noEmit`.

const KIT = resolve(import.meta.dirname, "../../..");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function argsFor(tsconfig: string | undefined): Promise<readonly string[]> {
  const dir = mkdtempSync(join(tmpdir(), "wt-tsc-refs-"));
  roots.push(dir);
  symlinkSync(join(KIT, "node_modules"), join(dir, "node_modules"));
  if (tsconfig !== undefined) writeFileSync(join(dir, "tsconfig.json"), tsconfig);
  const calls: (readonly string[])[] = [];
  const step: StepContext = {
    ctx: {
      cwd: dir,
      config: cfg(),
      base: "origin/main",
      enforce: "hard",
      env: {},
      exec: noExec,
      outDir: dir,
      artifacts: new Map(),
    },
    settings: cfg().hygiene,
    run: (_tool, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
    dir,
    out: (name) => join(dir, name),
    pkg: { name: "", version: "", exportsText: "" },
  };
  await tsc(step);
  return calls[0] ?? [];
}

describe("the hygiene tsc step and project references", () => {
  it.each([
    ['{ "references": [{ "path": "examples/service" }] }'],
    ['{"references":[{"path":"a"}]}'],
    ['{ "references" : [ { "path": "a" } ] }'],
    ['{\n  "include": ["src"],\n  "references": [\n    { "path": "a" }\n  ]\n}'],
    ['{\n  // the projects\n  "references": [{ "path": "a" }], /* trailing */\n}'],
  ])("builds a tsconfig that has references: %s", async (tsconfig) => {
    expect(await argsFor(tsconfig)).toEqual(["-b"]);
  });

  it.each([
    ['{ "include": ["src"] }'],
    ['{ "references": [] }'],
    ['{ // "references": [{ "path": "a" }]\n  "include": ["src"] }'],
    ['{ /* "references": [{ "path": "a" }] */ "include": ["src"] }'],
    ['{ "compilerOptions": { "paths": { "references": ["x"] } } }'],
    ["not a tsconfig"],
    [undefined],
  ])("checks %s with --noEmit", async (tsconfig) => {
    expect(await argsFor(tsconfig)).toEqual(["-b", "--noEmit"]);
  });
});
