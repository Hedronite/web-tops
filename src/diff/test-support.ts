import type { Exec, ExecResult } from "../gate/types.ts";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const made: string[] = [];

/** Runs git in `dir`, with an identity and no global config; a failing command fails the test that called it. */
export function git(dir: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A new repository on branch `main` with no commit. */
export function emptyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-diff-"));
  made.push(dir);
  git(dir, "init", "-q", "-b", "main");
  return dir;
}

/** A new repository on branch `main` with one commit holding `files`. */
export function makeRepo(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-diff-"));
  made.push(dir);
  git(dir, "init", "-q", "-b", "main");
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return dir;
}

export function write(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

/** Commits everything in `dir` and returns nothing. */
export function commit(dir: string, message: string): void {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

/** A directory with the given files and no repository: for a run whose git is a fake. */
export function plainDir(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-diff-"));
  made.push(dir);
  write(dir, files);
  return dir;
}

export interface Edit {
  readonly path: string;
  readonly kind: "added" | "modified";
  /** The new-side lines the edit touches; line 1 by default. */
  readonly range?: readonly [number, number];
}

/** A `git diff -U0` text for the edits: what the diff step would read from git. */
export function diffOf(edits: readonly Edit[]): string {
  const blocks = edits.map((edit) => {
    const [start, end] = edit.range ?? [1, 1];
    const count = end - start + 1;
    const old = edit.kind === "added" ? "/dev/null" : `a/${edit.path}`;
    const hunk =
      edit.kind === "added"
        ? `@@ -0,0 +${String(start)},${String(count)} @@`
        : `@@ -${String(start)},0 +${String(start)},${String(count)} @@`;
    const added = Array.from({ length: count }, () => "+x");
    return [
      `diff --git a/${edit.path} b/${edit.path}`,
      `--- ${old}`,
      `+++ b/${edit.path}`,
      hunk,
      ...added,
    ].join("\n");
  });
  return `${blocks.join("\n")}\n`;
}

/** The merge base the fake git gives. */
export const FAKE_BASE = "abc1234";

/**
 * A git that says the project is a full checkout on a branch whose merge base is `FAKE_BASE`, and gives `diff` as the
 * diff and `atBase` as the files at the merge base. It keeps the arguments of every call in `seen`.
 */
export function fakeGit(
  diff: string,
  atBase: Readonly<Record<string, string>> = {},
  seen: string[][] = [],
): Exec {
  return (_command, args) => {
    seen.push([...args]);
    return Promise.resolve(answerOf(args, diff, atBase));
  };
}

const said = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });

const ANSWERS: Readonly<Record<string, string>> = {
  "--is-shallow-repository": "false",
  "--is-inside-work-tree": "true",
};

function showOf(args: readonly string[], atBase: Readonly<Record<string, string>>): ExecResult {
  const text = atBase[args[1]?.slice(FAKE_BASE.length + 1).replace(/^\.\//u, "") ?? ""];
  return text === undefined ? { code: 128, stdout: "", stderr: "no such path" } : said(text);
}

function answerOf(
  args: readonly string[],
  diff: string,
  atBase: Readonly<Record<string, string>>,
): ExecResult {
  if (args[0] === "show") return showOf(args, atBase);
  if (args.includes("diff")) return said(diff);
  return said(args.map((arg) => ANSWERS[arg]).find((answer) => answer !== undefined) ?? FAKE_BASE);
}

export function cleanRepos(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
