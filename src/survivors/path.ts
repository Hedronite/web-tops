import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type LedgerPath =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };

/** Files the kit reads or the project owns: a ledger written over one of them would destroy it. */
const PROTECTED = ["web-tops.yaml", "web-tops.lock", "package.json"];

const lower = (path: string): string => path.toLowerCase();

function escapes(from: string, to: string): boolean {
  const inside = relative(from, to);
  return inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
}

/** The nearest part of the path that exists, walking up. */
function existingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
  return current;
}

const isProtected = (directory: string, resolved: string): boolean =>
  PROTECTED.some((name) => lower(join(directory, name)) === lower(resolved));

/** Why a file at this path cannot be the ledger, when it exists: a symlink, or not a regular file. */
function badTarget(resolved: string): string | undefined {
  if (!existsSync(resolved)) return undefined;
  const info = lstatSync(resolved);
  if (info.isSymbolicLink()) return "is a symbolic link";
  return info.isFile() ? undefined : "is not a regular file";
}

const isInside = (base: string, target: string): boolean =>
  target === base || !escapes(base, target);

/** Whether the part of the path that exists leads out of the project through a symlink. */
const leavesProject = (directory: string, resolved: string): boolean =>
  !isInside(realpathSync(directory), realpathSync(existingAncestor(resolved)));

type Check = (directory: string, path: string, resolved: string) => string | undefined;

/** The reasons a path cannot be the ledger, in the order they are looked for. */
const CHECKS: readonly Check[] = [
  (directory, path, resolved) =>
    path === "" || escapes(directory, resolved) ? "must name a file inside the project" : undefined,
  (directory, _path, resolved) =>
    isProtected(directory, resolved)
      ? `names a file the kit must not overwrite (${PROTECTED.join(", ")})`
      : undefined,
  (directory, _path, resolved) =>
    leavesProject(directory, resolved)
      ? "leads out of the project through a symbolic link"
      : undefined,
  (_directory, _path, resolved) => badTarget(resolved),
];

function refusal(directory: string, path: string, resolved: string): string | undefined {
  for (const check of CHECKS) {
    const message = check(directory, path, resolved);
    if (message !== undefined) return message;
  }
  return undefined;
}

/**
 * Where `gates.mutation.ledger` lands: a regular file (or none yet) inside the project directory, not
 * one of the kit's own files, and not reached through a symbolic link that leaves the project, nor itself
 * a link (the survivor ledger is written by `survivors explain`, so it follows the report path's rules).
 */
export function resolveLedgerPath(directory: string, path: string): LedgerPath {
  const resolved = resolve(directory, path);
  const message = refusal(directory, path, resolved);
  return message === undefined
    ? { ok: true, path: resolved }
    : { ok: false, message: `ledger "${path}" ${message}` };
}
