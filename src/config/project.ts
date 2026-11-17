import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "./profiles.ts";

function lists(manifest: unknown, field: string, name: string): boolean {
  const table: unknown =
    typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, field) : undefined;
  return typeof table === "object" && table !== null && Object.hasOwn(table, name);
}

/**
 * Reads the package.json in `dir`: the project depends on Astro when `astro` is in `dependencies`
 * or `devDependencies`. A missing or unreadable package.json is not Astro.
 */
export function readProject(dir: string): Project {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return {
      dependsOnAstro:
        lists(manifest, "dependencies", "astro") || lists(manifest, "devDependencies", "astro"),
    };
  } catch {
    return { dependsOnAstro: false };
  }
}
