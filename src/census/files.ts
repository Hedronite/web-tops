import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

/** Output and dependency folders hold no source of the project's own, at any depth. */
const OUTPUT = /(?:^|\/)(?:node_modules|dist|coverage|\.web-tops|\.astro)\//u;

/** True for a path outside the output and dependency folders. */
export const withinSource = (file: string): boolean => !OUTPUT.test(file);

/** The extensions of JavaScript and TypeScript source. */
export const SCRIPT_EXTENSIONS: readonly string[] = [
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
];

export const isScriptFile = (file: string): boolean =>
  SCRIPT_EXTENSIONS.includes(extname(file).toLowerCase());

/** A tracked file's text, or undefined when it is not there to read (deleted in the working tree, a submodule). */
export function readSource(cwd: string, file: string): string | undefined {
  try {
    return readFileSync(join(cwd, file), "utf8");
  } catch {
    return undefined;
  }
}
