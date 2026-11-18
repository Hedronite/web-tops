import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fire } from "./types.ts";

export const ROOT = dirname(fileURLToPath(import.meta.url));

export function toKey(path: string): string {
  return relative(ROOT, path).split("\\").join("/");
}

/** The installed version of a dependency, read from its own package.json. */
export function installedVersion(name: string): string {
  const raw = readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    return String(parsed.version);
  }
  throw new Error(`no version in ${name}/package.json`);
}

/**
 * A message becomes a Fire when its rule starts with the prefix, or a fatal Fire when it is a
 * parse or config error; anything else (an unused-directive note, say) is not a finding.
 */
export function fireOf(
  prefix: string,
  message: { readonly ruleId: string | null; readonly fatal?: boolean | undefined },
): Fire | undefined {
  if (message.ruleId?.startsWith(prefix) === true) {
    return { rule: message.ruleId.slice(prefix.length), fatal: false };
  }
  return message.fatal === true ? { rule: null, fatal: true } : undefined;
}

export function present<T>(value: T | undefined): value is T {
  return value !== undefined;
}
