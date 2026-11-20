import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** The name of the wrapper config, beside the scratch directory: it is not a file the probe lints. */
export const wrapperName = (): string => "laws-probe.eslint.config.mjs";

/**
 * An ESLint config that is the project's own, with one block more for the twins: type-aware rules read the scratch
 * `tsconfig.json`, which extends the project's and includes every twin, whatever `project` the project's config names.
 * A config that names the project's own `tsconfig.json` would not find the twins, which are not in that project.
 */
export function wrapperSource(config: string, scratch: string, cwd: string): string {
  const files = `${relative(cwd, scratch)}/**/*.{ts,tsx,mts,cts,astro}`;
  const parserOptions = {
    projectService: false,
    project: [join(scratch, "tsconfig.json")],
    tsconfigRootDir: scratch,
  };
  return [
    `const loaded = await import(${JSON.stringify(pathToFileURL(config).href)});`,
    "const base = loaded.default ?? loaded;",
    `const twins = { files: [${JSON.stringify(files)}], languageOptions: { parserOptions: ${JSON.stringify(parserOptions)} } };`,
    "export default [...(Array.isArray(base) ? base : [base]), twins];",
    "",
  ].join("\n");
}

/** The names ESLint looks for a flat config under, in its own order. */
const configNames = (): readonly string[] =>
  ["js", "mjs", "cjs", "ts", "mts", "cts"].map((extension) => `eslint.config.${extension}`);

/** The flat config ESLint finds for a project: the first of its names in the directory, or in the nearest one above. */
export function defaultConfig(cwd: string): string | undefined {
  const found = configNames()
    .map((name) => join(cwd, name))
    .find((path) => existsSync(path));
  const parent = dirname(cwd);
  return found ?? (parent === cwd ? undefined : defaultConfig(parent));
}

/** Writes the wrapper config beside the scratch directory and returns its path. */
export function writeWrapper(config: string, scratch: string, cwd: string): string {
  const path = join(dirname(scratch), wrapperName());
  writeFileSync(path, wrapperSource(config, scratch, cwd));
  return path;
}
