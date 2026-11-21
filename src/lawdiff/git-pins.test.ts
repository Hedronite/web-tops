import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec, ExecResult } from "../gate/types.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";
import { checkout, mergeBase, parseRenames, type Where } from "./git.ts";

afterAll(cleanTemp);

const place = (cwd: string, answer: (args: readonly string[]) => ExecResult): Where => {
  const exec: Exec = (_command, args) => Promise.resolve(answer(args));
  return { cwd, env: {}, exec };
};

const made = (args: readonly string[]): void => {
  if (args[0] === "worktree" && args[1] === "add") mkdirSync(String(args[4]));
};

describe("the merge base", () => {
  it("is an error when git exits non-zero, though it printed something", async () => {
    const where = place("/p", () => ({ code: 1, stdout: "abc\n", stderr: "fatal: no\n" }));
    expect(await mergeBase(where, "a", "b")).toEqual({
      error: "no merge base of a and b: fatal: no",
    });
  });
});

describe("a checkout", () => {
  it("is a folder of its own named for the tool, under the system's temporary folder", async () => {
    const where = place(tempDir(), (args) => {
      made(args);
      return { code: 0, stdout: "", stderr: "" };
    });
    const taken = await checkout(where, "ref");
    expect(basename(dirname(taken.dir)).startsWith("wt-lawdiff-")).toBe(true);
    expect(dirname(dirname(taken.dir))).toBe(tmpdir());
    await taken.cleanup();
  });

  it("links the project's node_modules only when it has one", async () => {
    const without = tempDir();
    const where = place(without, (args) => {
      made(args);
      return { code: 0, stdout: "", stderr: "" };
    });
    const taken = await checkout(where, "ref");
    expect(() => lstatSync(join(taken.dir, "node_modules"))).toThrow();
    await taken.cleanup();
    const withModules = tempDir();
    mkdirSync(join(withModules, "node_modules"));
    const here = place(withModules, (args) => {
      made(args);
      return { code: 0, stdout: "", stderr: "" };
    });
    const linked = await checkout(here, "ref");
    expect(lstatSync(join(linked.dir, "node_modules")).isSymbolicLink()).toBe(true);
    await linked.cleanup();
  });

  it("is taken down with its folder, and taking it down twice is harmless", async () => {
    const where = place(tempDir(), (args) => {
      made(args);
      return { code: 0, stdout: "", stderr: "" };
    });
    const taken = await checkout(where, "ref");
    const root = dirname(taken.dir);
    await taken.cleanup();
    expect(existsSync(root)).toBe(false);
    await taken.cleanup();
    expect(existsSync(root)).toBe(false);
  });

  it("removes its folder, and says exactly what git said, when the ref cannot be checked out", async () => {
    let dir = "";
    const where = place(tempDir(), (args) => {
      dir = String(args[4]);
      return { code: 128, stdout: "", stderr: "fatal: bad ref\n" };
    });
    await expect(checkout(where, "nope")).rejects.toEqual(
      new Error("cannot check out nope: fatal: bad ref"),
    );
    expect(existsSync(dirname(dir))).toBe(false);
  });
});

describe("the files a PR renamed", () => {
  it("are the pairs after each R status, in order, whatever other statuses stand between them", () => {
    const output = [
      "M",
      "m.ts",
      "R100",
      "a.ts",
      "b.ts",
      "A",
      "n.ts",
      "R050",
      "c.ts",
      "d.ts",
      "D",
      "z.ts",
      "R090",
      "e.ts",
      "f.ts",
      "",
    ].join("\0");
    expect([...parseRenames(output)]).toEqual([
      ["b.ts", "a.ts"],
      ["d.ts", "c.ts"],
      ["f.ts", "e.ts"],
    ]);
  });

  it("are none for no output, one status, or statuses that are not renames", () => {
    expect(parseRenames("").size).toBe(0);
    expect(parseRenames("\0").size).toBe(0);
    expect(parseRenames(["D", "gone.ts", "M", "x.ts"].join("\0")).size).toBe(0);
  });

  it("do not take a path that looks like a status for one", () => {
    const output = ["M", "R100", "R100", "x", "y", ""].join("\0");
    expect([...parseRenames(output)]).toEqual([["y", "x"]]);
  });
});
