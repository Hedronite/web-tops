import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";

/**
 * A page that ESLint stops reaching is reported file by file, as a JavaScript file is, on a real repository in a child
 * process with the project's own ESLint: a flat-config ignore, and a config without the Astro preset. A child process
 * runs the command, so no mutant is tested here and a mutation worker skips it.
 */

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../..");
const MAIN = join(REPO, "src/cli/main.ts");
const PRESET = join(REPO, "src/presets/eslint.js");
const SLOW = 180_000;
const PAGE = "---\nconst title = 'a';\n---\n<h1>{title}</h1>\n";

const astroConfig = (more: string): string =>
  [
    `import { eslintPreset } from "${PRESET}";`,
    'const base = await eslintPreset({ variant: "astro", tsconfigRootDir: import.meta.dirname, class: "astro-site" });',
    `export default [...base${more}];`,
    "",
  ].join("\n");

const tsOnlyConfig = [
  'import tseslint from "typescript-eslint";',
  'export default tseslint.config({ files: ["**/*.ts"], extends: [tseslint.configs.strict], languageOptions: { parser: tseslint.parser } });',
  "",
].join("\n");

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (done.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
  }
}

/** An astro-site on `main`, and the files that change on `feature`. */
function repo(change: Record<string, string>): string {
  const dir = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  put(dir, {
    ".gitignore": "node_modules\n.web-tops\n",
    "package.json": '{ "type": "module", "dependencies": { "astro": "5.0.0" } }\n',
    "tsconfig.json": JSON.stringify({
      extends: join(REPO, "tsconfig.json"),
      include: ["src/**/*"],
    }),
    "src/a.ts": "export const a: number = 1;\n",
    "src/page.astro": PAGE,
    "eslint.config.js": astroConfig(""),
  });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "switch", "-q", "-c", "feature");
  put(dir, change);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "change");
  return dir;
}

function lawDiff(cwd: string): { status: number | null; out: string; err: string } {
  const done = spawnSync("bun", [MAIN, "law-diff", "main", "feature"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, WEBTOPS_PROTOCOL_CHANGE_LABEL: "" },
  });
  return { status: done.status, out: done.stdout, err: done.stderr };
}

describe.skipIf(process.env["STRYKER_MUTATOR_WORKER"] !== undefined)(
  "webtops law-diff reads a page that ESLint stops reaching",
  () => {
    it(
      "refuses a flat-config ignore that drops a page, naming the page",
      () => {
        const done = lawDiff(
          repo({ "eslint.config.js": astroConfig(', { ignores: ["src/page.astro"] }') }),
        );
        expect(done.err).toBe("");
        expect(done.status).toBe(1);
        expect(done.out).toContain("no longer linted (src/page.astro)");
        expect(done.out).not.toContain("tool-missing");
      },
      SLOW,
    );

    it(
      "refuses a config without the Astro preset, which no longer reaches the page, naming it",
      () => {
        const done = lawDiff(repo({ "eslint.config.js": tsOnlyConfig }));
        expect(done.err).toBe("");
        expect(done.status).toBe(1);
        expect(done.out).toContain("no longer linted (src/page.astro)");
        expect(done.out).not.toContain("tool-missing");
      },
      SLOW,
    );

    it(
      "does not count an .eslintignore, which ESLint 10 does not read: the page is still linted, nothing weakened",
      () => {
        const done = lawDiff(repo({ ".eslintignore": "src/page.astro\n" }));
        expect(done.err).toBe("");
        expect(done.status).toBe(0);
        expect(done.out).not.toContain("no longer linted");
        expect(done.out).toContain("nothing weakened");
      },
      SLOW,
    );
  },
);
