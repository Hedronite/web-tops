import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanRepos, diffOf, FAKE_BASE, fakeGit, plainDir } from "./test-support.ts";

// The helpers that the diff tests take their git from, pinned so that what they say is what git would say.

const run = (git: ReturnType<typeof fakeGit>, ...args: string[]) => git("git", args, { cwd: "/x" });

describe("plainDir", () => {
  it("is a directory with the files, named for the diff tests, that cleanRepos removes", () => {
    const dir = plainDir({ "src/a.ts": "export {};\n" });
    expect(basename(dir).startsWith("wt-diff-")).toBe(true);
    expect(readFileSync(join(dir, "src/a.ts"), "utf8")).toBe("export {};\n");
    cleanRepos();
    expect(existsSync(dir)).toBe(false);
  });
});

describe("diffOf", () => {
  it("writes an added file as a -U0 diff from /dev/null, over the lines it gives", () => {
    expect(diffOf([{ path: "src/a.ts", kind: "added", range: [1, 2] }])).toBe(
      [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- /dev/null",
        "+++ b/src/a.ts",
        "@@ -0,0 +1,2 @@",
        "+x",
        "+x",
        "",
      ].join("\n"),
    );
  });

  it("writes a modified file against itself, at the lines it gives, and one line 1 by default", () => {
    expect(diffOf([{ path: "src/a.ts", kind: "modified", range: [3, 5] }])).toBe(
      [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -3,0 +3,3 @@",
        "+x",
        "+x",
        "+x",
        "",
      ].join("\n"),
    );
    expect(diffOf([{ path: "b.ts", kind: "modified" }])).toContain("@@ -1,0 +1,1 @@");
  });

  it("puts the files one after another", () => {
    const text = diffOf([
      { path: "a.ts", kind: "added" },
      { path: "b.ts", kind: "modified" },
    ]);
    expect(text.split("\n").filter((line) => line.startsWith("diff --git"))).toEqual([
      "diff --git a/a.ts b/a.ts",
      "diff --git a/b.ts b/b.ts",
    ]);
  });
});

describe("fakeGit", () => {
  it("says a full checkout whose merge base is FAKE_BASE", async () => {
    const git = fakeGit("");
    expect((await run(git, "rev-parse", "--is-inside-work-tree")).stdout).toBe("true");
    expect((await run(git, "rev-parse", "--is-shallow-repository")).stdout).toBe("false");
    expect((await run(git, "rev-parse", "--verify", "--quiet", "main^{commit}")).stdout).toBe(
      FAKE_BASE,
    );
    expect((await run(git, "merge-base", "HEAD", "main")).stdout).toBe(FAKE_BASE);
  });

  it("gives the diff it was given", async () => {
    expect((await run(fakeGit("the diff"), "-c", "x=y", "diff", "--", "ref")).stdout).toBe(
      "the diff",
    );
  });

  it("gives a file at the merge base, and a failure for a file that was not there", async () => {
    const git = fakeGit("", { "src/a.ts": "text" });
    expect(await run(git, "show", `${FAKE_BASE}:src/a.ts`)).toEqual({
      code: 0,
      stdout: "text",
      stderr: "",
    });
    expect(await run(git, "show", `${FAKE_BASE}:src/b.ts`)).toEqual({
      code: 128,
      stdout: "",
      stderr: "no such path",
    });
    expect((await run(git, "show")).code).toBe(128);
  });

  it("keeps the arguments of every call", async () => {
    const seen: string[][] = [];
    await run(fakeGit("", {}, seen), "merge-base", "HEAD", "main");
    expect(seen).toEqual([["merge-base", "HEAD", "main"]]);
  });
});
