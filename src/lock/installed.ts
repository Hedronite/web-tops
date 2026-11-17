import { readFileSync } from "node:fs";
import { join } from "node:path";
import { field } from "./config.ts";

function versionOf(doc: unknown): string | undefined {
  const version = field(doc, "version");
  return typeof version === "string" && version !== "" ? version : undefined;
}

/** The version of `tool` installed under `dir/node_modules`, or undefined when it cannot be read. */
export function installedVersion(dir: string, tool: string): string | undefined {
  try {
    const doc: unknown = JSON.parse(
      readFileSync(join(dir, "node_modules", tool, "package.json"), "utf8"),
    );
    return versionOf(doc);
  } catch {
    return undefined;
  }
}

const parts = (version: string): number[] =>
  version
    .replace(/^v/, "")
    .replace(/-.*$/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);

/** Negative, zero or positive as `a` is older than, the same as or newer than `b` (dotted numbers; a prerelease tag is ignored). */
export function compareVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  const width = Math.max(left.length, right.length);
  const diffs = Array.from({ length: width }, (_, i) => (left[i] ?? 0) - (right[i] ?? 0));
  return diffs.find((diff) => diff !== 0) ?? 0;
}
