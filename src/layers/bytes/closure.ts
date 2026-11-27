import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

function isExternalRef(target: string): boolean {
  const trimmed = target.trim();
  return trimmed === "" || trimmed.startsWith("//") || SCHEME_RE.test(trimmed);
}

function specifierString(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function statementSpecifier(stmt: ts.Statement): string | undefined {
  if (ts.isImportDeclaration(stmt)) return specifierString(stmt.moduleSpecifier);
  if (ts.isExportDeclaration(stmt)) return specifierString(stmt.moduleSpecifier);
  return undefined;
}

/** Extracts static ESM `import ... from`, `export ... from`, and bare `import "..."` specifiers (never dynamic `import()`). */
export function extractStaticImports(code: string): string[] {
  const sf = ts.createSourceFile("module.js", code, ts.ScriptTarget.ES2023);
  const out: string[] = [];
  for (const stmt of sf.statements) {
    const spec = statementSpecifier(stmt);
    if (spec !== undefined) out.push(spec);
  }
  return out;
}

function stripQueryAndHash(trimmed: string): string {
  const hash = trimmed.indexOf("#");
  const noHash = hash === -1 ? trimmed : trimmed.slice(0, hash);
  const q = noHash.indexOf("?");
  return (q === -1 ? noHash : noHash.slice(0, q)).trim();
}

function cleanSpecifierPath(spec: string): string | undefined {
  const rawPath = stripQueryAndHash(spec);
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }
}

function isRelativeOrRoot(spec: string): boolean {
  return (
    !spec.startsWith("//") &&
    (spec.startsWith("/") || spec.startsWith("./") || spec.startsWith("../"))
  );
}

function resolveInsideDist(fromFile: string, cleanPath: string): string {
  const joined = cleanPath.startsWith("/")
    ? cleanPath
    : posix.join(posix.dirname(fromFile), cleanPath);
  return posix.normalize(joined).replace(/^\//u, "");
}

function resolveDistModule(fromFile: string, spec: string): string | undefined {
  const cleanPath = cleanSpecifierPath(spec);
  return cleanPath === undefined ? undefined : resolveInsideDist(fromFile, cleanPath);
}

function htmlRootRef(fromPage: string, target: string): string | undefined {
  const cleanPath = cleanSpecifierPath(target);
  return cleanPath === undefined ? undefined : resolveInsideDist(fromPage, cleanPath);
}

export type ClosureResult =
  | { readonly ok: true; readonly modules: readonly string[] }
  | { readonly ok: false; readonly reason: string };

interface TraversalState {
  readonly distDir: string;
  readonly files: ReadonlySet<string>;
  readonly visited: Set<string>;
  readonly queue: string[];
}

function enqueueModule(
  state: TraversalState,
  relFile: string | undefined,
  rawSpec: string,
  fromFile: string,
): string | undefined {
  if (relFile === undefined || !state.files.has(relFile)) {
    return `missing JS module "${rawSpec}" referenced from ${fromFile}`;
  }
  if (!state.visited.has(relFile)) {
    state.visited.add(relFile);
    state.queue.push(relFile);
  }
  return undefined;
}

function seedBodySpecs(state: TraversalState, pageFile: string, body: string): string | undefined {
  for (const spec of extractStaticImports(body)) {
    if (!isRelativeOrRoot(spec)) continue;
    const err = enqueueModule(state, resolveDistModule(pageFile, spec), spec, pageFile);
    if (err !== undefined) return err;
  }
  return undefined;
}

function seedInlineImports(
  state: TraversalState,
  pageFile: string,
  bodies: readonly string[],
): string | undefined {
  for (const body of bodies) {
    const err = seedBodySpecs(state, pageFile, body);
    if (err !== undefined) return err;
  }
  return undefined;
}

function seedExternalRefs(
  state: TraversalState,
  pageFile: string,
  refs: readonly { readonly target: string }[],
): string | undefined {
  for (const ref of refs) {
    if (isExternalRef(ref.target)) continue;
    const err = enqueueModule(state, htmlRootRef(pageFile, ref.target), ref.target, pageFile);
    if (err !== undefined) return err;
  }
  return undefined;
}

function stepModule(state: TraversalState, file: string): string | undefined {
  const source = readFileSync(join(state.distDir, file), "utf8");
  for (const spec of extractStaticImports(source)) {
    if (!isRelativeOrRoot(spec)) continue;
    const err = enqueueModule(state, resolveDistModule(file, spec), spec, file);
    if (err !== undefined) return err;
  }
  return undefined;
}

function runBfs(state: TraversalState): string | undefined {
  let next = state.queue.shift();
  while (next !== undefined) {
    const err = stepModule(state, next);
    if (err !== undefined) return err;
    next = state.queue.shift();
  }
  return undefined;
}

/** Computes the deduplicated, cycle-safe static ESM closure of one HTML page through `dist/`. */
export function resolvePageModuleClosure(
  distDir: string,
  files: ReadonlySet<string>,
  pageFile: string,
  inlineBodies: readonly string[],
  externalRefs: readonly { readonly target: string }[],
): ClosureResult {
  const state: TraversalState = { distDir, files, visited: new Set(), queue: [] };
  const err =
    seedExternalRefs(state, pageFile, externalRefs) ??
    seedInlineImports(state, pageFile, inlineBodies) ??
    runBfs(state);
  return err === undefined
    ? { ok: true, modules: [...state.visited].sort() }
    : { ok: false, reason: err };
}
