import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Exec } from "../gate/types.ts";
import type { Checkout } from "./run.ts";

export interface Where {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exec: Exec;
}

/** The commit the two refs last had in common: what the PR changed from. */
export async function mergeBase(
  where: Where,
  base: string,
  head: string,
): Promise<string | { readonly error: string }> {
  const done = await where.exec("git", ["merge-base", "--", base, head], {
    cwd: where.cwd,
    env: where.env,
  });
  const sha = done.stdout.trim();
  return done.code === 0 && sha !== ""
    ? sha
    : { error: `no merge base of ${base} and ${head}: ${done.stderr.trim()}` };
}

/**
 * A detached worktree of a ref in a folder of its own, with this project's `node_modules` beside it so the tools the
 * diff runs are the project's own. Taking it down removes the worktree and the folder, and nothing else.
 */
export async function checkout(where: Where, ref: string): Promise<Checkout> {
  const root = mkdtempSync(join(tmpdir(), "wt-lawdiff-"));
  const dir = join(root, "tree");
  const added = await where.exec("git", ["worktree", "add", "--detach", "--", dir, ref], {
    cwd: where.cwd,
    env: where.env,
  });
  if (added.code !== 0) {
    rmSync(root, { recursive: true });
    throw new Error(`cannot check out ${ref}: ${added.stderr.trim()}`);
  }
  const modules = join(where.cwd, "node_modules");
  if (existsSync(modules)) symlinkSync(modules, join(dir, "node_modules"));
  return {
    dir,
    cleanup: async () => {
      await where.exec("git", ["worktree", "remove", "--force", dir], {
        cwd: where.cwd,
        env: where.env,
      });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Where a tracked path moved to: the rename statuses of `git diff -M --name-status -z`, as new path to old path. */
export function parseRenames(output: string): Map<string, string> {
  const tokens = output.split("\0");
  const renames = new Map<string, string>();
  let skip = 0;
  for (const [at, status] of tokens.entries()) {
    if (skip > 0) {
      skip -= 1;
    } else if (status.startsWith("R")) {
      renames.set(String(tokens[at + 2]), String(tokens[at + 1]));
      skip = 2;
    } else {
      skip = 1;
    }
  }
  return renames;
}

/** The files the PR renamed: each new path with the path it had at the merge base. */
export async function renames(
  where: Where,
  base: string,
  head: string,
): Promise<ReadonlyMap<string, string> | { readonly error: string }> {
  const done = await where.exec("git", ["diff", "-M", "--name-status", "-z", base, head, "--"], {
    cwd: where.cwd,
    env: where.env,
  });
  return done.code === 0
    ? parseRenames(done.stdout)
    : { error: `cannot list the files ${head} renamed from ${base}: ${done.stderr.trim()}` };
}
