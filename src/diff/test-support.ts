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

export function cleanRepos(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
