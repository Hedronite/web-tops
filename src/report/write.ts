import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Report } from "./types.ts";

export type ReportPath =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };

/** The path is the directory itself, climbs out of it, or lands elsewhere (compared as written, no symlinks followed). */
function escapes(directory: string, resolved: string): boolean {
  const inside = relative(directory, resolved);
  return inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
}

/**
 * Where `report.path` lands: inside the config directory, and on a file. A path that climbs out, an
 * absolute path elsewhere, or the directory itself is refused (`gate` exits 2 at `/report/path`). The
 * check is on the path as written; it does not follow symlinks. `report` (G6) reads the same file.
 */
export function resolveReportPath(directory: string, path: string): ReportPath {
  const resolved = resolve(directory, path);
  if (path === "" || escapes(directory, resolved)) {
    return {
      ok: false,
      message: `report.path "${path}" must name a file inside the config directory`,
    };
  }
  return { ok: true, path: resolved };
}

/** Writes the report as JSON with a trailing newline, creating its directory (WEB_TOPS.md section 6.6). */
export function writeReport(path: string, report: Report): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}
