import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec, ExecResult } from "../gate/types.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";
import { checkout, mergeBase, parseRenames, renames, type Where } from "./git.ts";

afterAll(cleanTemp);

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

function where(cwd: string, answer: (call: Call) => ExecResult, calls: Call[]): Where {
  const exec: Exec = (command, args, options) => {
    const call = { command, args, cwd: options?.cwd };
    calls.push(call);
    return Promise.resolve(answer(call));
  };
  return { cwd, env: { A: "1" }, exec };
}

const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });

describe("the merge base", () => {
  it("is what git says, trimmed, asked in the project", async () => {
    const calls: Call[] = [];
    const found = await mergeBase(
      where("/proj", () => ok("abc\n"), calls),
      "origin/main",
      "feat",
    );
    expect(found).toBe("abc");
    expect(calls).toEqual([
      { command: "git", args: ["merge-base", "--", "origin/main", "feat"], cwd: "/proj" },
    ]);
  });

  it("is an error with git's words when there is none, or git printed nothing", async () => {
    const failing = where("/p", () => ({ code: 1, stdout: "", stderr: "fatal: not valid\n" }), []);
    expect(await mergeBase(failing, "a", "b")).toEqual({
      error: "no merge base of a and b: fatal: not valid",
    });
    const silent = where("/p", () => ok(""), []);
    expect(await mergeBase(silent, "a", "b")).toEqual({ error: "no merge base of a and b: " });
  });
});

describe("a checkout of a ref", () => {
  it("is a detached worktree in a folder of its own beside the project's node_modules, taken down with its folder", async () => {
    const project = tempDir();
    mkdirSync(join(project, "node_modules"));
    const calls: Call[] = [];
    const place = where(
      project,
      (call) => {
        if (call.args[0] === "worktree" && call.args[1] === "add") mkdirSync(String(call.args[4]));
        return ok();
      },
      calls,
    );
    const made = await checkout(place, "feature");
    expect(calls[0]).toEqual({
      command: "git",
      args: ["worktree", "add", "--detach", "--", made.dir, "feature"],
      cwd: project,
    });
    expect(made.dir.endsWith("/tree")).toBe(true);
    expect(lstatSync(join(made.dir, "node_modules")).isSymbolicLink()).toBe(true);
    await made.cleanup();
    expect(calls[1]).toEqual({
      command: "git",
      args: ["worktree", "remove", "--force", made.dir],
      cwd: project,
    });
    expect(existsSync(made.dir)).toBe(false);
    expect(existsSync(join(made.dir, ".."))).toBe(false);
  });

  it("links no node_modules when the project has none, and throws with git's words when the ref cannot be checked out", async () => {
    const project = tempDir();
    const place = where(
      project,
      (call) => {
        if (call.args[1] === "add") mkdirSync(String(call.args[4]));
        return ok();
      },
      [],
    );
    const made = await checkout(place, "f");
    expect(existsSync(join(made.dir, "node_modules"))).toBe(false);
    await made.cleanup();
    const refused = where(
      project,
      () => ({ code: 128, stdout: "", stderr: "fatal: bad ref\n" }),
      [],
    );
    await expect(checkout(refused, "nope")).rejects.toThrow(
      "cannot check out nope: fatal: bad ref",
    );
  });
});

describe("the files a PR renamed", () => {
  it("are each new path with the path it had, from the rename statuses, and nothing for other statuses", () => {
    const output = [
      "M",
      "src/a.ts",
      "R100",
      "src/old.ts",
      "src/new.ts",
      "A",
      "src/b.ts",
      "R087",
      "x.ts",
      "y.ts",
      "D",
      "z.ts",
      "",
    ].join("\0");
    expect([...parseRenames(output)]).toEqual([
      ["src/new.ts", "src/old.ts"],
      ["y.ts", "x.ts"],
    ]);
    expect(parseRenames("").size).toBe(0);
    expect(parseRenames(["M", "src/a.ts", ""].join("\0")).size).toBe(0);
  });

  it("are asked of git between the merge base and the head, with rename detection", async () => {
    const calls: Call[] = [];
    const output = ["R100", "a.ts", "b.ts", ""].join("\0");
    const found = await renames(
      where("/proj", () => ok(output), calls),
      "base",
      "head",
    );
    expect("error" in found ? [] : [...found]).toEqual([["b.ts", "a.ts"]]);
    expect(calls).toEqual([
      {
        command: "git",
        args: ["diff", "-M", "--name-status", "-z", "base", "head", "--"],
        cwd: "/proj",
      },
    ]);
  });

  it("are an error with git's words when git cannot say", async () => {
    const failing = where("/p", () => ({ code: 128, stdout: "", stderr: "fatal: bad\n" }), []);
    expect(await renames(failing, "base", "head")).toEqual({
      error: "cannot list the files head renamed from base: fatal: bad",
    });
  });
});
