import { lstatSync, mkdirSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec } from "../gate/types.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";
import { checkout, type Where } from "./git.ts";

afterAll(cleanTemp);

/** What a ref tracks, as the worktree git would make: the folders and files named, each file empty. */
function tracking(files: readonly string[]): Where {
  const exec: Exec = (_command, args) => {
    if (args[0] === "worktree" && args[1] === "add") {
      const tree = String(args[4]);
      for (const file of files) {
        mkdirSync(join(tree, dirname(file)), { recursive: true });
        writeFileSync(join(tree, file), "{}");
      }
    }
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  return { cwd: project, env: {}, exec };
}

let project = "";

function installed(...folders: string[]): void {
  project = tempDir();
  for (const folder of folders)
    mkdirSync(join(project, folder, "node_modules"), { recursive: true });
}

const linked = (tree: string, folder: string): boolean => {
  try {
    return lstatSync(join(tree, folder, "node_modules")).isSymbolicLink();
  } catch {
    return false;
  }
};

describe("a checkout of a project that has nested packages", () => {
  it("links the node_modules of a nested package the project has installed, at any depth, and the root's", async () => {
    installed(".", "examples/service", "tools/a/b");
    const taken = await checkout(
      tracking(["package.json", "examples/service/package.json", "tools/a/b/package.json"]),
      "ref",
    );
    expect(linked(taken.dir, "examples/service")).toBe(true);
    expect(linked(taken.dir, "tools/a/b")).toBe(true);
    expect(linked(taken.dir, ".")).toBe(true);
    expect(readlinkSync(join(taken.dir, "examples/service/node_modules"))).toBe(
      join(project, "examples/service/node_modules"),
    );
    expect(readlinkSync(join(taken.dir, "node_modules"))).toBe(join(project, "node_modules"));
    await taken.cleanup();
  });

  it("links nothing for a nested package the project has not installed, or for a folder with no tracked package.json", async () => {
    installed("examples/other", "scripts");
    mkdirSync(join(project, "examples/service"), { recursive: true });
    const taken = await checkout(
      tracking([
        "examples/service/package.json",
        "examples/other/index.ts",
        "scripts/package.json.bak",
      ]),
      "ref",
    );
    expect(linked(taken.dir, "examples/service")).toBe(false);
    expect(linked(taken.dir, "examples/other")).toBe(false);
    expect(linked(taken.dir, "scripts")).toBe(false);
    await taken.cleanup();
  });
});
