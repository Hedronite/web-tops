import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { onTestFinished } from "vitest";

export const ROOT = resolve(import.meta.dirname, "../..");

/**
 * A project outside the kit that reaches it only as `node_modules/web-tops`, the way an inited
 * project does. `files` are written relative to the project; it is an ES module project. Call it
 * from inside a test: the project is removed when that test finishes.
 */
export function scratchProject(files: Readonly<Record<string, string>> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-preset-"));
  onTestFinished(() => {
    rmSync(dir, { recursive: true });
  });
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(ROOT, join(dir, "node_modules", "web-tops"));
  // eslint-plugin-astro finds the TypeScript parser from the project it lints, as an adopter has it.
  symlinkSync(
    join(ROOT, "node_modules", "typescript-eslint"),
    join(dir, "node_modules", "typescript-eslint"),
  );
  const all = { "package.json": '{ "type": "module" }\n', ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

export interface Ran {
  readonly status: number | null;
  /** Standard output and standard error together. */
  readonly output: string;
  readonly stdout: string;
}

export function run(command: string, args: readonly string[], cwd: string): Ran {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    stdout: result.stdout,
  };
}

export const bin = (name: string): string => join(ROOT, "node_modules", ".bin", name);

/** The one-line eslint.config.js `webtops init` writes, for a variant. */
export const configFor = (variant: string): string =>
  `import { eslintPreset } from "web-tops/eslint";\nexport default await eslintPreset({\n  variant: "${variant}",\n  tsconfigRootDir: import.meta.dirname,\n});\n`;

export const TSCONFIG =
  '{ "extends": "web-tops/tsconfig/strict.json", "compilerOptions": { "noEmit": true }, "include": ["src"] }\n';
