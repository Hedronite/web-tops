import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "./profiles.ts";

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function lists(manifest: unknown, field: string, name: string): boolean {
  const table: unknown = isObject(manifest) ? Reflect.get(manifest, field) : undefined;
  return isObject(table) && Object.hasOwn(table, name);
}

function isPrivate(manifest: unknown): boolean {
  return isObject(manifest) && Reflect.get(manifest, "private") === true;
}

/**
 * Reads the package.json in `dir`: the project depends on Astro when `astro` is in `dependencies`,
 * `devDependencies` or `peerDependencies`. It is private when `private` is `true`. A missing or unreadable package.json is neither.
 */
export function readProject(dir: string): Project {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return {
      dependsOnAstro: ["dependencies", "devDependencies", "peerDependencies"].some((field) =>
        lists(manifest, field, "astro"),
      ),
      isPrivate: isPrivate(manifest),
    };
  } catch {
    return { dependsOnAstro: false };
  }
}
