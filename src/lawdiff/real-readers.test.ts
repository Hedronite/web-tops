import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";

/**
 * The surfaces the readers add, on a real repository, in a child process, with the project's own ESLint, Stylelint,
 * dependency-cruiser and TypeScript: a commit that drops a JavaScript file from ESLint, turns a Stylelint rule off,
 * ignores a CSS file, lowers a dependency-cruiser rule and narrows a tsconfig include is refused on each surface.
 */

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../..");
const MAIN = join(REPO, "src/cli/main.ts");
const SLOW = 180_000;

const eslintConfig = (ignores: string): string =>
  [
    'import tseslint from "typescript-eslint";',
    "export default tseslint.config(",
    '  { files: ["**/*.ts"], extends: [tseslint.configs.strict], languageOptions: { parser: tseslint.parser } },',
    '  { files: ["**/*.js"], rules: { "no-var": "error" } },',
    ignores,
    ");",
    "",
  ].join("\n");

const stylelintConfig = (rule: string): string =>
  `export default { rules: { "color-no-invalid-hex": ${rule}, "block-no-empty": true } };\n`;

const cruiseConfig = (severity: string): string =>
  `module.exports = { forbidden: [{ name: "no-circular", severity: "${severity}", from: {}, to: { circular: true } }] };\n`;

const tsconfig = (include: string): string =>
  JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", strict: true },
    include: [include],
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
    "tsconfig.json": tsconfig("src"),
    "src/a.ts": "export const a: number = 1;\n",
    "src/legacy.js": "export function legacy() {\n  return 1;\n}\n",
    "src/styles/a.css": "a { color: red; }\n",
    "src/styles/b.css": "b { color: red; }\n",
    "eslint.config.js": eslintConfig(""),
    "stylelint.config.mjs": stylelintConfig("true"),
    ".dependency-cruiser.cjs": cruiseConfig("error"),
  });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "switch", "-q", "-c", "feature");
  put(dir, {
    "tsconfig.json": tsconfig("lib"),
    "eslint.config.js": eslintConfig('  { ignores: ["src/legacy.js"] },'),
    "stylelint.config.mjs": stylelintConfig("null"),
    ".stylelintignore": "src/styles/b.css\n",
    ".dependency-cruiser.cjs": cruiseConfig("warn"),
  });
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "weaken");
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

/** A child process runs the command, so no mutant of this repository is tested here: a mutation worker skips it. */
describe.skipIf(process.env["STRYKER_MUTATOR_WORKER"] !== undefined)(
  "webtops law-diff reads ESLint over JavaScript, Stylelint, dependency-cruiser and tsconfig file sets",
  () => {
    it(
      "refuses a commit that weakens each, and lists what it does not compare",
      () => {
        const done = lawDiff(repo());
        expect(done.err).toBe("");
        expect(done.status).toBe(1);
        expect(done.out).toContain("weakened: no-var: error -> no longer linted (src/legacy.js)");
        expect(done.out).toContain(
          "weakened: color-no-invalid-hex: error -> off (src/styles/a.css and 1 more)",
        );
        expect(done.out).toContain("weakened: forbidden: no-circular: error -> warn");
        expect(done.out).toContain("weakened: tsconfig.json: include: listed -> not listed (src)");
        expect(done.out).toContain(
          "weakened: tsconfig.json: program: in the project -> no longer in the project (src/a.ts)",
        );
      },
      SLOW,
    );
  },
);
