import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";

/**
 * The command on a real repository, in a child process, with the project's own ESLint and TypeScript: a commit that
 * turns a rule off and drops a compiler flag is refused with every surface listed, and the label lets it through. The
 * run is in a child process, so this covers the process boundary and the tools, not the command's code, which the tests
 * beside it judge; it is not run inside a Stryker worker, where it would run again for every mutant and cover none of
 * the code under mutation.
 */

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../..");
const MAIN = join(REPO, "src/cli/main.ts");
const SLOW = 120_000;
const ANY = "@typescript-eslint/no-explicit-any";
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

const eslintConfig = (override: string): string =>
  [
    'import tseslint from "typescript-eslint";',
    "export default tseslint.config(",
    '  { files: ["**/*.ts"], extends: [tseslint.configs.strict], languageOptions: { parser: tseslint.parser } },',
    override,
    ");",
    "",
  ].join("\n");

const tsconfig = (strict: boolean): string =>
  JSON.stringify({
    compilerOptions: {
      target: "es2022",
      module: "nodenext",
      strict,
      noUncheckedIndexedAccess: true,
    },
    include: ["src"],
  });

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (done.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
  }
}

function repo(): string {
  const dir = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  put(dir, {
    ".gitignore": "node_modules\n.web-tops\n",
    "package.json": '{ "type": "module" }\n',
    "tsconfig.json": tsconfig(true),
    "src/a.ts": "export const a: number = 1;\n",
    "eslint.config.js": eslintConfig(""),
  });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "switch", "-q", "-c", "feature");
  put(dir, {
    "tsconfig.json": tsconfig(false),
    "eslint.config.js": eslintConfig(`  { files: ["src/**"], rules: { "${ANY}": "off" } },`),
  });
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "weaken");
  return dir;
}

function lawDiff(
  cwd: string,
  ...args: string[]
): { status: number | null; out: string; err: string } {
  const done = spawnSync("bun", [MAIN, "law-diff", "main", "feature", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, WEBTOPS_PROTOCOL_CHANGE_LABEL: "" },
  });
  return { status: done.status, out: done.stdout, err: done.stderr };
}

describe.skipIf(insideStryker)("webtops law-diff on a real repository", () => {
  it(
    "refuses a commit that turns a rule off and drops a flag, naming each surface, and passes it with the label",
    () => {
      const dir = repo();
      const refused = lawDiff(dir);
      expect(refused.err).toBe("");
      expect(refused.status).toBe(1);
      for (const surface of [
        "ESLint rule levels and options: ",
        "compiler flags: ",
        "gate settings, floors, caps and budgets",
        "law catalog",
        "profile",
        "tool versions",
      ]) {
        expect(refused.out).toContain(surface);
      }
      expect(refused.out).toContain(`weakened: ${ANY}: error -> off (src/a.ts)`);
      expect(refused.out).toContain("weakened: tsconfig.json: strict: true -> false");
      expect(refused.out).toContain("not excused");
      const excused = lawDiff(dir, "--label-present");
      expect(excused.status).toBe(0);
      expect(excused.out).toContain("excused, the protocol-change label is present");
    },
    SLOW,
  );

  it(
    "refuses an override that turns a rule off for a file the PR adds, and only for it",
    () => {
      const dir = tempDir();
      symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
      put(dir, {
        ".gitignore": "node_modules\n.web-tops\n",
        "package.json": '{ "type": "module" }\n',
        "tsconfig.json": tsconfig(true),
        "src/a.ts": "export const a: number = 1;\n",
        "eslint.config.js": eslintConfig(""),
      });
      git(dir, "init", "-q", "-b", "main");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "base");
      git(dir, "switch", "-q", "-c", "feature");
      put(dir, {
        "src/added.ts": "export const added: number = 2;\n",
        "eslint.config.js": eslintConfig(
          `  { files: ["src/added.ts"], rules: { "${ANY}": "off" } },`,
        ),
      });
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "add a file nothing lints");
      const refused = lawDiff(dir);
      expect(refused.status).toBe(1);
      expect(refused.out).toContain(`weakened: ${ANY}: error -> off (src/added.ts)`);
      expect(refused.out).not.toContain("src/a.ts");
    },
    SLOW,
  );

  it(
    "follows a rename: the file moved to a path the override turns a rule off for is held to what its old path had",
    () => {
      const dir = tempDir();
      symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
      put(dir, {
        ".gitignore": "node_modules\n.web-tops\n",
        "package.json": '{ "type": "module" }\n',
        "tsconfig.json": tsconfig(true),
        "src/old.ts": "export const kept: number = 1;\nexport const more: number = 2;\n",
        "eslint.config.js": eslintConfig(""),
      });
      git(dir, "init", "-q", "-b", "main");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "base");
      git(dir, "switch", "-q", "-c", "feature");
      git(dir, "mv", "src/old.ts", "src/legacy.ts");
      put(dir, {
        "eslint.config.js": eslintConfig(
          `  { files: ["src/legacy.ts"], rules: { "${ANY}": "off" } },`,
        ),
      });
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "rename under an override");
      const refused = lawDiff(dir);
      expect(refused.status).toBe(1);
      expect(refused.out).toContain(`weakened: ${ANY}: error -> off (src/legacy.ts)`);
    },
    SLOW,
  );
});
