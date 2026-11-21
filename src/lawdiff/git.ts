import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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

const isNestedManifest = (file: string): boolean =>
  basename(file) === "package.json" && dirname(file) !== ".";

/** The folders below the root of a tree that hold a `package.json` and, in the project, a `node_modules` beside it. */
function nestedModules(project: string, tree: string): string[] {
  return readdirSync(tree, { recursive: true, encoding: "utf8" })
    .filter(isNestedManifest)
    .map((file) => dirname(file))
    .filter((folder) => existsSync(join(project, folder, "node_modules")));
}

/**
 * A detached worktree of a ref in a folder of its own, with this project's `node_modules` beside it so the tools the
 * diff runs are the project's own, and the `node_modules` of each nested package the project has installed, beside the
 * `package.json` the ref tracks for it: a project that gates itself inside this one is read with its own tools. Taking
 * it down removes the worktree and the folder, and nothing else.
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
  for (const folder of nestedModules(where.cwd, dir)) {
    symlinkSync(join(where.cwd, folder, "node_modules"), join(dir, folder, "node_modules"));
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
