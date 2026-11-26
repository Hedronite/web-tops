import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** One HTML page discovered inside `dist/`, with its canonical URL route and raw byte length. */
export interface DistPage {
  readonly file: string;
  readonly route: string;
  readonly bytes: number;
}

/** Deterministic inventory of files and HTML pages inside the built `dist/` tree. */
export interface DistInventory {
  readonly distDir: string;
  readonly pages: readonly DistPage[];
  readonly files: readonly string[];
}

export type ResolveDistResult =
  { readonly ok: true; readonly dir: string } | { readonly ok: false; readonly reason: string };

/** Whether `target` stays inside `root` by path normalization (without traversing parent directories). */
export function isWithinDir(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function insideTarget(cwd: string, trimmed: string, raw: string): ResolveDistResult {
  const target = resolve(cwd, trimmed);
  return isWithinDir(resolve(cwd), target)
    ? { ok: true, dir: target }
    : { ok: false, reason: `build directory "${raw}" escapes project root` };
}

/** Validates that the configured build output path stays within `cwd`, without requiring it to exist yet. */
export function checkTargetPath(cwd: string, configuredDir = "dist"): ResolveDistResult {
  const trimmed = configuredDir.trim();
  if (trimmed === "" || isAbsolute(trimmed)) {
    return { ok: false, reason: `build directory "${configuredDir}" must be a relative path` };
  }
  return insideTarget(cwd, trimmed, configuredDir);
}

function checkRealTarget(cwd: string, target: string): ResolveDistResult {
  const realRoot = realpathSync(cwd);
  const realTarget = realpathSync(target);
  if (!isWithinDir(realRoot, realTarget)) {
    return { ok: false, reason: `build directory "${target}" resolves outside project root` };
  }
  return statSync(realTarget).isDirectory()
    ? { ok: true, dir: realTarget }
    : { ok: false, reason: `build directory "${target}" is not a directory` };
}

function realDirCheck(cwd: string, target: string): ResolveDistResult {
  try {
    return checkRealTarget(cwd, target);
  } catch (error) {
    return { ok: false, reason: `cannot inspect build directory: ${String(error)}` };
  }
}

/** Resolves and verifies that the built output directory exists inside `cwd` and is a directory. */
export function resolveDistDir(cwd: string, configuredDir = "dist"): ResolveDistResult {
  const checked = checkTargetPath(cwd, configuredDir);
  if (!checked.ok) return checked;
  if (!existsSync(checked.dir)) {
    return { ok: false, reason: `build directory "${configuredDir}" is missing` };
  }
  return realDirCheck(cwd, checked.dir);
}

/** Canonical URL route for a POSIX path relative to `dist/` (`index.html` -> `/`, `a/index.html` -> `/a/`). */
export function routeForHtml(relPosix: string): string {
  if (relPosix === "index.html") return "/";
  if (relPosix.endsWith("/index.html")) return `/${relPosix.slice(0, -"index.html".length)}`;
  return `/${relPosix}`;
}

function cmpPosix(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function visitEntry(base: string, rel: string, out: string[]): void {
  const lstat = lstatSync(join(base, rel));
  if (lstat.isSymbolicLink()) return;
  if (lstat.isDirectory()) {
    walkFiles(base, rel, out);
    return;
  }
  if (lstat.isFile()) out.push(rel.split(sep).join("/"));
}

function walkFiles(base: string, sub: string, out: string[]): void {
  const current = sub === "" ? base : join(base, sub);
  const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
    cmpPosix(a.name, b.name),
  );
  for (const entry of entries) {
    const rel = sub === "" ? entry.name : `${sub}/${entry.name}`;
    visitEntry(base, rel, out);
  }
}

/** Deterministically scans an existing `dist/` directory into sorted files and HTML page entries. */
export function scanDist(distDir: string): DistInventory {
  const raw: string[] = [];
  walkFiles(distDir, "", raw);
  const files = [...raw].sort(cmpPosix);
  const pages = files
    .filter((file) => file.endsWith(".html"))
    .map((file) => ({
      file,
      route: routeForHtml(file),
      bytes: statSync(join(distDir, file)).size,
    }));
  return { distDir, pages, files };
}
