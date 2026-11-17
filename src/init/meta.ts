import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface PackageMeta {
  readonly name: string;
  readonly version: string;
}

function field(doc: unknown, key: string): unknown {
  if (typeof doc !== "object" || doc === null) return undefined;
  return Reflect.get(doc, key);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The package name and version `init` writes into web-tops.yaml: from `package.json` in the
 * directory, else the directory's own name and `0.0.0`.
 */
export function readPackageMeta(dir: string): PackageMeta {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    doc = undefined;
  }
  return {
    name: nonEmpty(field(doc, "name")) ?? basename(dir),
    version: nonEmpty(field(doc, "version")) ?? "0.0.0",
  };
}

/** Whether the project's package.json lists `astro` in `dependencies` or `devDependencies` (WEB_TOPS.md section 9). */
export function declaresAstro(dir: string): boolean {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return false;
  }
  return ["dependencies", "devDependencies"].some((group) => {
    const listed = field(doc, group);
    return typeof listed === "object" && listed !== null && Reflect.has(listed, "astro");
  });
}
