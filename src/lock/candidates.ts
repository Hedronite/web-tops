import { readFileSync } from "node:fs";
import { join } from "node:path";
import { field } from "./config.ts";
import { isExactVersion } from "./format.ts";
import { TOOL_PINS } from "./pins.ts";

export type Candidates =
  { readonly ok: true; readonly names: string[] } | { readonly ok: false; readonly error: string };

type PackageRead =
  { readonly ok: true; readonly doc: unknown } | { readonly ok: false; readonly error: string };

/** The package.json sections whose exact entries are tools the lock may take. */
const SECTIONS = ["dependencies", "devDependencies"] as const;

/** Names the lock handles itself: the running kit and the Node range. */
const OWN = new Set(["webtops", "node"]);

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function entriesOf(value: unknown): [string, unknown][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value);
}

/** The names a package.json pins to one exact version in `dependencies` or `devDependencies`. */
export function exactDeps(doc: unknown): string[] {
  return SECTIONS.flatMap((section) =>
    entriesOf(field(doc, section))
      .filter(([, spec]) => typeof spec === "string" && isExactVersion(spec))
      .map(([name]) => name),
  );
}

const isAbsent = (error: unknown): boolean =>
  error instanceof Error && Reflect.get(error, "code") === "ENOENT";

function readPackage(dir: string): PackageRead {
  const path = join(dir, "package.json");
  try {
    const doc: unknown = JSON.parse(readFileSync(path, "utf8"));
    return { ok: true, doc };
  } catch (error) {
    if (isAbsent(error)) return { ok: true, doc: undefined };
    const why = error instanceof Error ? error.message : "unreadable";
    return { ok: false, error: `package.json is not readable: ${why}` };
  }
}

/**
 * The tools `lock --update` may add to the lock: every pinned tool (pins.ts) and every exact entry
 * of the project's package.json, once each and sorted. Whether a name is installed is the caller's
 * question; a project's `package.json` that is absent offers the pins alone.
 */
export function candidateTools(dir: string): Candidates {
  const read = readPackage(dir);
  if (!read.ok) return read;
  const names = new Set([...Object.keys(TOOL_PINS), ...exactDeps(read.doc)]);
  return { ok: true, names: [...names].filter((name) => !OWN.has(name)).sort(byName) };
}
