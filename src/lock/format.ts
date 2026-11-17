import { parse, stringify } from "yaml";
import { isNodeRange } from "./node.ts";

/**
 * A parsed `web-tops.lock`: each tool, and `webtops` itself, mapped to one exact version, and
 * `node` to the range the tools run in.
 */
export type Lock = Readonly<Record<string, string>>;

export type LockParse =
  { readonly ok: true; readonly lock: Lock } | { readonly ok: false; readonly error: string };

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const EMPTY: LockParse = { ok: false, error: "web-tops.lock is empty" };

const HEADER =
  "# web-tops.lock: exact tool versions and the Node range (WEB_TOPS.md section 10).\n" +
  "# Change it with `webtops lock --update`, as a reviewed change.\n";

type Parsed =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

function readYaml(text: string): Parsed {
  try {
    return { ok: true, value: parse(text) };
  } catch (error) {
    const why = error instanceof Error ? error.message : "unreadable";
    return { ok: false, error: `web-tops.lock is not valid YAML: ${why}` };
  }
}

function toEntries(value: unknown): [string, unknown][] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Object.entries(value);
}

/** `node` holds a range; every other entry holds one exact version, never a range. */
function accepts(tool: string, version: string): boolean {
  return tool === "node" ? isNodeRange(version) : EXACT.test(version);
}

function rejection(tool: string, version: unknown): LockParse {
  const what = tool === "node" ? "a Node range" : "an exact version";
  return { ok: false, error: `${tool}: ${JSON.stringify(version)} is not ${what}` };
}

function notAMap(value: unknown): LockParse {
  if (value === null || value === undefined) return EMPTY;
  return { ok: false, error: "web-tops.lock must be a map from tool to exact version" };
}

function collect(entries: readonly [string, unknown][]): LockParse {
  const lock: Record<string, string> = {};
  for (const [tool, version] of entries) {
    if (typeof version !== "string" || !accepts(tool, version)) return rejection(tool, version);
    lock[tool] = version;
  }
  return { ok: true, lock };
}

/** Reads a lock file; every tool value must be an exact version, and `node` a range. */
export function parseLock(text: string): LockParse {
  const parsed = readYaml(text);
  if (!parsed.ok) return parsed;
  const entries = toEntries(parsed.value);
  if (entries === undefined) return notAMap(parsed.value);
  return entries.length === 0 ? EMPTY : collect(entries);
}

/** Writes a lock file: header comment, keys sorted, one final newline, same bytes for the same map. */
export function serializeLock(lock: Lock): string {
  const sorted = Object.fromEntries(
    Object.entries(lock).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return HEADER + stringify(sorted, { defaultStringType: "PLAIN", lineWidth: 0 });
}
