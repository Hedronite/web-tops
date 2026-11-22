import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";

/**
 * The scanner's and knip's config on a real repository, in a child process: a change that lets the scanner's AWS rule
 * allow anything, or that widens what knip leaves out, is refused on its surface, and a change that moves nothing is
 * not. A child process runs the command, so no mutant is tested here and a mutation worker skips it.
 */

afterAll(cleanTemp);

const MAIN = join(resolve(import.meta.dirname, "../.."), "src/cli/main.ts");
const SLOW = 120_000;
const PRESET = "@secretlint/secretlint-rule-preset-recommend";
const AWS = "@secretlint/secretlint-rule-aws";

const secretlintrc = (allows: string[]): string =>
  JSON.stringify({ rules: [{ id: PRESET, rules: [{ id: AWS, options: { allows } }] }] });

const BASE: Record<string, string> = {
  ".gitignore": "node_modules\n",
  "package.json": '{ "type": "module" }\n',
  ".secretlintrc.json": secretlintrc(["/je7MtGbClwBF\\/2Zp9Utk\\/h3yCo8nvbEXAMPLEKEY/"]),
  "knip.json": JSON.stringify({ entry: ["src/main.ts"], project: ["src/**"] }),
  "src/main.ts": "export const main = 1;\n",
};

function git(cwd: string, ...args: string[]): void {
  const done = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (done.status !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr}`);
}

/** A repository with the base files on `main` and the change on `feature`. */
function repo(change: Record<string, string>): string {
  const dir = tempDir();
  put(dir, BASE);
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
  "webtops law-diff over the scanner's and knip's config",
  () => {
    it(
      "refuses an allow that matches everything on the AWS rule, naming the rule and the pattern",
      () => {
        const done = lawDiff(repo({ ".secretlintrc.json": secretlintrc(["/.*/"]) }));
        expect(done.err).toBe("");
        expect(done.status).toBe(1);
        expect(done.out).toContain(
          `weakened: allows ${PRESET} > ${AWS}: not listed -> listed (/.*/)`,
        );
        expect(done.out).toContain("secretlint rules, allow lists and ignores (W-39):");
      },
      SLOW,
    );

    it(
      "refuses a .secretlintignore that leaves a folder out of the scan, and an ignored dependency of knip",
      () => {
        const ignored = lawDiff(repo({ ".secretlintignore": "fixtures/**\n" }));
        expect(ignored.status).toBe(1);
        expect(ignored.out).toContain(
          "weakened: secretlintignore: not listed -> listed (.secretlintignore: fixtures/**)",
        );
        const knip = lawDiff(
          repo({
            "knip.json": JSON.stringify({
              entry: ["src/main.ts"],
              project: ["src/**"],
              ignoreDependencies: ["left-pad"],
            }),
          }),
        );
        expect(knip.status).toBe(1);
        expect(knip.out).toContain("weakened: ignoreDependencies: not listed -> listed (left-pad)");
      },
      SLOW,
    );

    it(
      "refuses a narrower knip project, and passes a change that moves nothing",
      () => {
        const narrowed = lawDiff(
          repo({ "knip.json": JSON.stringify({ entry: ["src/main.ts"], project: [] }) }),
        );
        expect(narrowed.status).toBe(1);
        expect(narrowed.out).toContain("weakened: project: listed -> not listed (src/**)");
        const quiet = lawDiff(repo({ "src/main.ts": "export const main = 2;\n" }));
        expect(quiet.err).toBe("");
        expect(quiet.status).toBe(0);
        expect(quiet.out).toContain("nothing weakened");
        expect(quiet.out).toContain("knip ignores, entries, projects and rule levels (W-48):");
      },
      SLOW,
    );

    it(
      "says in every report what it does not compare of the two tools' config",
      () => {
        const done = lawDiff(repo({ "src/main.ts": "export const main = 3;\\n" }));
        expect(done.out).toContain("secretlint configuration in any file but .secretlintrc.json");
        expect(done.out).toContain("what .gitignore leaves out of a secretlint scan");
        expect(done.out).toContain("knip plugin options beyond entry and project");
      },
      SLOW,
    );
  },
);
