import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Report } from "./types.ts";

export type ReportPath =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };

/** The path is the directory itself, climbs out of it, or lands elsewhere (compared as written, no symlinks followed). */
function escapes(directory: string, resolved: string): boolean {
  const inside = relative(directory, resolved);
  return inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
}

/** Files the kit reads or the project owns: a report written over one of them would destroy it (R37). */
const PROTECTED = ["web-tops.yaml", "web-tops.lock", "package.json"];

/** The real path when the file exists (a symlink is followed), else the path as given. */
export function realOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Case-insensitive, because the file systems this runs on (macOS, Windows) are. */
function sameFile(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The path names a protected file, directly or through a symlink. */
function isProtected(directory: string, resolved: string): boolean {
  const real = realOf(resolved);
  return PROTECTED.some((name) => {
    const file = join(directory, name);
    return sameFile(resolved, file) || sameFile(real, realOf(file));
  });
}

function refusal(directory: string, path: string, resolved: string): string | undefined {
  if (path === "" || escapes(directory, resolved)) {
    return `report.path "${path}" must name a file inside the config directory`;
  }
  return isProtected(directory, resolved)
    ? `report.path "${path}" names a file the kit must not overwrite (${PROTECTED.join(", ")})`
    : undefined;
}

/**
 * Where `report.path` lands: inside the config directory, on a file, and not on `web-tops.yaml`,
 * `web-tops.lock` or `package.json`, directly or through a symlink. A path that climbs out, an absolute
 * path elsewhere, or the directory itself is refused (`gate` exits 2 at `/report/path`). The directory
 * check is on the path as written. A tracked file is refused by `gate`, which asks git. `report` (G6) reads
 * the same file.
 */
export function resolveReportPath(directory: string, path: string): ReportPath {
  const resolved = resolve(directory, path);
  const message = refusal(directory, path, resolved);
  return message === undefined ? { ok: true, path: resolved } : { ok: false, message };
}

/** Writes the report as JSON with a trailing newline, creating its directory (WEB_TOPS.md section 6.6). */
export function writeReport(path: string, report: Report): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}
