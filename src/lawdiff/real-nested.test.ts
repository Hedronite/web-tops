import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";

/**
 * A project that gates itself inside this one, on a real repository in a child process: it extends the kit with its
 * own `node_modules` (untracked, beside its tracked `package.json`), and both refs are read with it. A child process
 * runs the command, so no mutant is tested here and a mutation worker skips it.
 */

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../..");
const MAIN = join(REPO, "src/cli/main.ts");
const SLOW = 180_000;

const nestedConfig = (more: string): string =>
  [
    'import { eslintPreset } from "web-tops/eslint";',
    'const base = await eslintPreset({ variant: "base", tsconfigRootDir: import.meta.dirname });',
    `export default [...base${more}];`,
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

/** A root project and an example inside it that has its own installed `web-tops`; `main` and a `feature` that changes it. */
function repo(change: Record<string, string>): string {
  const dir = tempDir();
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"));
  const modules = join(dir, "examples/service/node_modules");
  mkdirSync(modules, { recursive: true });
  symlinkSync(REPO, join(modules, "web-tops"));
  put(dir, {
    ".gitignore": "node_modules\n.web-tops\n",
    "package.json": '{ "type": "module" }\n',
    "tsconfig.json": JSON.stringify({ extends: join(REPO, "tsconfig.json"), include: ["src"] }),
    "src/a.ts": "export const a: number = 1;\n",
    "eslint.config.js": 'export default [{ files: ["**/*.ts"], rules: { "no-var": "error" } }];\n',
    "examples/service/package.json": '{ "type": "module" }\n',
    "examples/service/tsconfig.json": JSON.stringify({
      extends: "web-tops/tsconfig/strict.json",
      include: ["src"],
    }),
    "examples/service/src/b.ts": "export const b: number = 2;\n",
    "examples/service/eslint.config.js": nestedConfig(""),
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
  "webtops law-diff reads a nested project with its own node_modules",
  () => {
    it(
      "reads both refs, and passes a change that weakens nothing",
      () => {
        const done = lawDiff(
          repo({ "examples/service/src/b.ts": "export const b: number = 3;\n" }),
        );
        expect(done.err).toBe("");
        expect(done.out).not.toContain("cannot be read");
        expect(done.status).toBe(0);
        expect(done.out).toContain("nothing weakened");
      },
      SLOW,
    );

    it(
      "still sees a rule the nested config turns off",
      () => {
        const off = ', { rules: { "@typescript-eslint/no-explicit-any": "off" } }';
        const done = lawDiff(repo({ "examples/service/eslint.config.js": nestedConfig(off) }));
        expect(done.err).toBe("");
        expect(done.out).not.toContain("cannot be read");
        expect(done.status).toBe(1);
        expect(done.out).toContain("weakened: @typescript-eslint/no-explicit-any: error -> off");
        expect(done.out).toContain("(examples/service/eslint.config.js and 1 more)");
      },
      SLOW,
    );
  },
);
