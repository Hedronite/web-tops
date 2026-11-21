import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempProject, type TempProject } from "../../gate/testkit.ts";
import { resolveTool, TOOLS } from "./tooling.ts";

/** R29 N6: a tool resolves through the installed package's `bin` field, in the project's node_modules, and nowhere else. */

const projects: TempProject[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    project.cleanup();
  }
});

function put(dir: string, path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

function project(): TempProject {
  const made = tempProject();
  projects.push(made);
  return made;
}

const SPEC = { package: "demo", bin: "demo" };

describe("G3d tools: resolveTool reads the installed package's bin field", () => {
  it("takes a string bin as the one executable", () => {
    const { dir } = project();
    put(dir, "node_modules/demo/package.json", JSON.stringify({ bin: "cli/run.js" }));
    put(dir, "node_modules/demo/cli/run.js", "");
    expect(resolveTool(dir, SPEC)).toBe(join(dir, "node_modules", "demo", "cli", "run.js"));
  });

  it("takes the entry for the tool's own command from an object bin, not another command's", () => {
    const { dir } = project();
    put(
      dir,
      "node_modules/demo/package.json",
      JSON.stringify({ bin: { other: "bin/other.js", demo: "bin/demo.js" } }),
    );
    put(dir, "node_modules/demo/bin/other.js", "");
    put(dir, "node_modules/demo/bin/demo.js", "");
    expect(resolveTool(dir, SPEC)).toBe(join(dir, "node_modules", "demo", "bin", "demo.js"));
  });

  it("finds nothing when the package is absent, has no bin, or names no entry for the command", () => {
    const { dir } = project();
    expect(resolveTool(dir, SPEC)).toBeUndefined();
    put(dir, "node_modules/demo/package.json", JSON.stringify({ name: "demo" }));
    expect(resolveTool(dir, SPEC)).toBeUndefined();
    put(dir, "node_modules/demo/package.json", JSON.stringify({ bin: { other: "bin/other.js" } }));
    put(dir, "node_modules/demo/bin/other.js", "");
    expect(resolveTool(dir, SPEC)).toBeUndefined();
  });

  it("finds nothing when the bin file the manifest names is not on disk", () => {
    const { dir } = project();
    put(dir, "node_modules/demo/package.json", JSON.stringify({ bin: { demo: "bin/demo.js" } }));
    expect(resolveTool(dir, SPEC)).toBeUndefined();
  });

  it("finds nothing when the manifest is not JSON", () => {
    const { dir } = project();
    put(dir, "node_modules/demo/package.json", "{ not json");
    expect(resolveTool(dir, SPEC)).toBeUndefined();
  });

  it("names the package each gate tool installs from", () => {
    expect([...TOOLS].map(([name, spec]) => [name, spec.package])).toEqual([
      ["tsc", "typescript"],
      ["astro", "astro"],
      ["eslint", "eslint"],
      ["stylelint", "stylelint"],
      ["prettier", "prettier"],
      ["biome", "@biomejs/biome"],
      ["depcruise", "dependency-cruiser"],
      ["publint", "publint"],
      ["attw", "@arethetypeswrong/cli"],
      ["vitest", "vitest"],
      ["stryker", "@stryker-mutator/core"],
      ["secretlint", "secretlint"],
      ["knip", "knip"],
    ]);
  });

  it("runs each gate tool through the bin of its own name", () => {
    expect([...TOOLS].map(([name, spec]) => [name, spec.bin])).toEqual(
      [...TOOLS.keys()].map((name) => [name, name]),
    );
  });
});
