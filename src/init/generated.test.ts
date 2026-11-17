import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { ESLint } from "eslint";
import * as prettier from "prettier";
import { afterAll, describe, expect, it } from "vitest";
import { runInit } from "./run.ts";
import { put } from "./test-support.ts";

// What init writes has to pass the tools it configures. These run the real Prettier, ESLint and
// dependency-cruiser on the generated files; a file that only parses is not enough.

const root = resolve(import.meta.dirname, "../..");
const CLASSES = ["ts-library", "ui-components", "astro-site", "web-app", "node-service"] as const;
const FORMATTED = [
  "eslint.config.js",
  "stylelint.config.js",
  ".dependency-cruiser.cjs",
  "tsconfig.strict.json",
  ".github/workflows/web-tops.yml",
  "web-tops.yaml",
  "AGENTS.md",
];
/** Prettier's own width, which an inited project gets because init writes it no config, and the kit's. */
const WIDTHS = [80, 100];

const made: string[] = [];

/** A directory under the repo's ignored `tmp/`, so the generated files resolve the kit's own packages. */
function repoTemp(): string {
  mkdirSync(join(root, "tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, "tmp", "wt-generated-"));
  made.push(dir);
  return dir;
}

function generated(className: string): string {
  const dir = repoTemp();
  const out = runInit({ className, dir, force: false });
  if (out.code !== 0) throw new Error(out.problems.join("; "));
  return dir;
}

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/**
 * The files Prettier would change at `width`. No config is resolved: init writes the project none, so
 * what applies is Prettier's defaults, and the kit's `printWidth` is tried as well.
 */
async function unformatted(dir: string, width: number): Promise<string[]> {
  const bad: string[] = [];
  for (const file of FORMATTED) {
    const text = readFileSync(join(dir, file), "utf8");
    if (!(await prettier.check(text, { filepath: join(dir, file), printWidth: width }))) {
      bad.push(file);
    }
  }
  return bad;
}

describe.each(CLASSES)("the files webtops init --class %s writes: Prettier", (className) => {
  it.each(WIDTHS)("formats every generated file as Prettier does at width %i", async (width) => {
    expect(await unformatted(generated(className), width)).toEqual([]);
  });
});

/** Lints the generated `file` from `dir` as if it sat in `under`, the directory whose ESLint config applies. */
async function lintMessages(
  eslint: ESLint,
  under: string,
  dir: string,
  file: string,
): Promise<string[]> {
  const text = readFileSync(join(dir, file), "utf8");
  const results = await eslint.lintText(text, { filePath: join(under, file) });
  return results.flatMap((result) =>
    result.messages.map((message) => `${message.ruleId ?? "parse"}: ${message.message}`),
  );
}

describe("the files webtops init writes: ESLint", () => {
  // The astro and React variants import plugins the kit does not install, so the config under test
  // is the base one; every class's other files are linted with it.
  const baseDir = generated("ts-library");
  const eslint = new ESLint({ cwd: baseDir });

  it.each(["eslint.config.js", ".dependency-cruiser.cjs", "stylelint.config.js"])(
    "lints %s clean under the generated config",
    async (file) => {
      expect(await lintMessages(eslint, baseDir, baseDir, file)).toEqual([]);
    },
  );

  it("ignores .astro/, which astro check writes, so a type file there is not linted", async () => {
    expect(await eslint.isPathIgnored(join(baseDir, ".astro", "types.d.ts"))).toBe(true);
  });

  it.each(CLASSES)("%s's eslint.config.js ignores .astro/ and the usual output", (className) => {
    const text = readFileSync(join(generated(className), "eslint.config.js"), "utf8");
    const ignores = /ignores: \[([^\]]*)\]/.exec(text)?.[1] ?? "";
    for (const entry of ["node_modules/", "coverage/", "dist/", ".astro/", ".web-tops/"]) {
      expect(ignores, entry).toContain(`"${entry}"`);
    }
  });

  it.each(CLASSES)("lints the %s CommonJS and Stylelint config files clean", async (className) => {
    const dir = generated(className);
    expect(await lintMessages(eslint, baseDir, dir, ".dependency-cruiser.cjs")).toEqual([]);
    expect(await lintMessages(eslint, baseDir, dir, "stylelint.config.js")).toEqual([]);
  });

  it("lints node-service's eslint.config.js clean under itself", async () => {
    const dir = generated("node-service");
    const own = new ESLint({ cwd: dir });
    expect(await lintMessages(own, dir, dir, "eslint.config.js")).toEqual([]);
  });
});

const DEPCRUISE = join(root, "node_modules", ".bin", "depcruise");
const TSCONFIG = {
  compilerOptions: {
    module: "ESNext",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    noEmit: true,
    target: "ES2023",
  },
};

/** A project holding the generated dependency-cruiser config and the given `src/` files. */
function projectWith(files: Readonly<Record<string, string>>): string {
  const dir = generated("ts-library");
  put(dir, "tsconfig.json", JSON.stringify(TSCONFIG));
  for (const [name, text] of Object.entries(files)) put(dir, `src/${name}`, text);
  return dir;
}

function cruise(dir: string): { status: number | null; output: string } {
  const run = spawnSync(DEPCRUISE, ["src", "--config", ".dependency-cruiser.cjs"], {
    cwd: dir,
    encoding: "utf8",
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe("the files webtops init writes: dependency-cruiser", () => {
  it("loads, and passes a project that imports a package through its exports", () => {
    const dir = projectWith({
      "a.ts":
        'import { parse } from "yaml";\nimport { b } from "./b.ts";\nexport const a = [parse, b];\n',
      "b.ts": "export const b = 1;\n",
    });
    const { status, output } = cruise(dir);
    expect(output).toContain("no dependency violations");
    expect(status).toBe(0);
  });

  it("fails a planted import cycle at no-circular", () => {
    const dir = projectWith({
      "a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
      "b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
    });
    const { status, output } = cruise(dir);
    expect(status).not.toBe(0);
    expect(output).toContain("no-circular");
  });

  it("fails a planted import into a package's dist at no-unresolvable", () => {
    const dir = projectWith({ "a.ts": 'import "yaml/dist/index.js";\nexport const a = 1;\n' });
    const { status, output } = cruise(dir);
    expect(status).not.toBe(0);
    expect(output).toContain("no-unresolvable");
  });

  it("carries no rule that matches resolved dist paths, which flags every normal import", () => {
    const text = readFileSync(join(generated("ts-library"), ".dependency-cruiser.cjs"), "utf8");
    expect(text).not.toContain("no-deep-dist-imports");
    expect(text).toContain("no-unresolvable");
  });
});
