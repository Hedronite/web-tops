import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Problem } from "../config/types.ts";
import { parseYaml } from "../config/validate.ts";
import type { Lock } from "./format.ts";
import { parseLock } from "./format.ts";
import { NODE_RANGE } from "./pins.ts";

export type ConfigRead =
  | { readonly state: "absent" }
  | { readonly state: "invalid"; readonly error: string }
  | { readonly state: "ok"; readonly doc: unknown };

export type LockRead =
  | { readonly state: "absent" }
  | { readonly state: "invalid"; readonly error: string }
  | { readonly state: "ok"; readonly lock: Lock };

/** One key path out of a parsed document of unknown shape; undefined when any step is absent. */
export function field(doc: unknown, ...path: readonly string[]): unknown {
  let node: unknown = doc;
  for (const key of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = Reflect.get(node, key);
  }
  return node;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

const firstMessage = (problems: readonly Problem[]): string => problems[0]?.message ?? "unreadable";

/** Reads `web-tops.yaml` in `dir` as a bare document; the full check is `webtops check`'s job. */
export function readConfigDoc(dir: string): ConfigRead {
  const text = readText(join(dir, "web-tops.yaml"));
  if (text === undefined) return { state: "absent" };
  const parsed = parseYaml(text);
  if (parsed.ok) return { state: "ok", doc: parsed.value };
  return { state: "invalid", error: firstMessage(parsed.problems) };
}

/** Reads `web-tops.lock` in `dir`: absent, unreadable as a lock (with the reason), or the lock. */
export function readLockFile(dir: string): LockRead {
  const text = readText(join(dir, "web-tops.lock"));
  if (text === undefined) return { state: "absent" };
  const parsed = parseLock(text);
  return parsed.ok ? { state: "ok", lock: parsed.lock } : { state: "invalid", error: parsed.error };
}

/** The Node range the lock records, the protocol's range when there is no lock or it records none, else why the lock is unreadable. */
export function lockedNodeRange(
  dir: string,
): { readonly range: string } | { readonly error: string } {
  const read = readLockFile(dir);
  if (read.state === "invalid") return { error: read.error };
  return { range: (read.state === "ok" ? read.lock["node"] : undefined) ?? NODE_RANGE };
}
