import { parse, stringify } from "yaml";

/** A parsed `web-tops.lock`: each tool, and `webtops` itself, mapped to one exact version. */
export type Lock = Readonly<Record<string, string>>;

export type LockParse =
  { readonly ok: true; readonly lock: Lock } | { readonly ok: false; readonly error: string };

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const HEADER =
  "# web-tops.lock: exact tool versions (WEB_TOPS.md section 10).\n" +
  "# Change it with `webtops lock --update`, as a reviewed change.\n";

/** Reads a lock file; every value must be an exact version string, never a range. */
export function parseLock(text: string): LockParse {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (error) {
    return { ok: false, error: `web-tops.lock is not valid YAML: ${errorText(error)}` };
  }
  if (doc === null || doc === undefined) return { ok: false, error: "web-tops.lock is empty" };
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, error: "web-tops.lock must be a map from tool to exact version" };
  }
  const lock: Record<string, string> = {};
  for (const [tool, version] of Object.entries(doc)) {
    if (typeof version !== "string" || !EXACT.test(version)) {
      return { ok: false, error: `${tool}: ${JSON.stringify(version)} is not an exact version` };
    }
    lock[tool] = version;
  }
  if (Object.keys(lock).length === 0) return { ok: false, error: "web-tops.lock is empty" };
  return { ok: true, lock };
}

/** Writes a lock file: header comment, keys sorted, one final newline, same bytes for the same map. */
export function serializeLock(lock: Lock): string {
  const sorted = Object.fromEntries(
    Object.entries(lock).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return HEADER + stringify(sorted, { defaultStringType: "PLAIN", lineWidth: 0 });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "unreadable";
}
