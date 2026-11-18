import { readFileSync } from "node:fs";
import { join } from "node:path";
import { field } from "./config.ts";
import { TOOL_PINS } from "./pins.ts";

export type Candidates =
  { readonly ok: true; readonly names: string[] } | { readonly ok: false; readonly error: string };

type PackageRead =
  { readonly ok: true; readonly doc: unknown } | { readonly ok: false; readonly error: string };

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isAbsent = (error: unknown): boolean =>
  error instanceof Error && Reflect.get(error, "code") === "ENOENT";

function readPackage(dir: string): PackageRead {
  try {
    const doc: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { ok: true, doc };
  } catch (error) {
    if (isAbsent(error)) return { ok: true, doc: undefined };
    const why = error instanceof Error ? error.message : "unreadable";
    return { ok: false, error: `package.json is not readable: ${why}` };
  }
}

/** The names a package.json declares in `dependencies` or `devDependencies`, whatever the version spec. */
export function declaredNames(doc: unknown): Set<string> {
  const names = ["dependencies", "devDependencies"].flatMap((section) => {
    const entries: unknown = field(doc, section);
    return typeof entries === "object" && entries !== null ? Object.keys(entries) : [];
  });
  return new Set(names);
}

/**
 * The tools `lock --update` may add to the lock, and `lock --verify` expects it to hold: the tools
 * WEB_TOPS.md section 2 pins (pins.ts) that the project declares in its package.json (section 10: the
 * lock pins "the tools listed in section 2 and `webtops` itself"). A tool installed only because
 * something else needs it, such as a hoisted dependency, is not the project's tool. A library the
 * project depends on that section 2 does not pin never is. With no package.json, the pins alone.
 */
export function candidateTools(dir: string): Candidates {
  const read = readPackage(dir);
  if (!read.ok) return read;
  const declared = read.doc === undefined ? undefined : declaredNames(read.doc);
  const names = Object.keys(TOOL_PINS).filter(
    (name) => declared === undefined || declared.has(name),
  );
  return { ok: true, names: names.sort(byName) };
}
