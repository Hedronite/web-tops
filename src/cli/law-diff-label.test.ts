import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Answer, Api } from "../lawdiff/label.ts";
import type { Exec, ExecResult } from "../gate/types.ts";
import { cleanTemp } from "../laws/probe/testkit.ts";
import type { Io } from "./io.ts";
import { apiOf, runWith } from "./law-diff.ts";

afterAll(cleanTemp);

/** R111 through the command: a PR that weakens a flag is excused by the label only when an account with the right permission applied it. */

const REPO = resolve(import.meta.dirname, "../..");
const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });

function tree(dir: string, strict: boolean): void {
  mkdirSync(dir);
  const options = `{ "strict": ${String(strict)} }`;
  writeFileSync(join(dir, "tsconfig.json"), `{ "compilerOptions": ${options}, "include": [] }\n`);
}

/** A git with two refs: `old` has strict on and `new` has it off, so the diff weakens one flag. */
const weakening: Exec = (_command, args) => {
  if (args[0] === "worktree" && args[1] === "add") tree(String(args[4]), args[5] === "old");
  return Promise.resolve(args[0] === "merge-base" ? ok("old\n") : ok());
};

function run(env: Record<string, string>, api: Api | undefined, argv: string[] = ["old", "new"]) {
  let out = "";
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: () => undefined,
    cwd: REPO,
    env,
  };
  return runWith(argv, io, weakening, api).then((code) => ({ code, out }));
}

const WORKFLOW = {
  WEBTOPS_PROTOCOL_CHANGE_LABEL: "1",
  GITHUB_REPOSITORY: "o/r",
  PR_NUMBER: "7",
  GITHUB_TOKEN: "t",
};

const stub =
  (name: string): Api =>
  (path): Promise<Answer> =>
    Promise.resolve(
      path.includes("/events")
        ? {
            status: 200,
            body: [{ event: "labeled", label: { name: "protocol-change" }, actor: { login: "x" } }],
          }
        : { status: 200, body: { role_name: name } },
    );

describe("the label through the command", () => {
  it.each([
    [
      "admin",
      0,
      ": excused, the protocol-change label was applied by an account with admin permission",
    ],
    [
      "maintain",
      0,
      ": excused, the protocol-change label was applied by an account with maintain permission",
    ],
    [
      "write",
      1,
      ": not excused, the protocol-change label was applied by an account with write permission",
    ],
  ])("a weakening labelled by an account with %s permission exits %i", async (name, code, said) => {
    const done = await run(WORKFLOW, stub(name));
    expect(done.code).toBe(code);
    expect(done.out).toContain(said);
  });

  it("is not excused by --label-present when the workflow's API is there: only the label the workflow saw counts", async () => {
    const env = { ...WORKFLOW, WEBTOPS_PROTOCOL_CHANGE_LABEL: "0" };
    const done = await run(env, stub("admin"), ["old", "new", "--label-present"]);
    expect(done.code).toBe(1);
    expect(done.out).toContain("the protocol-change label is absent");
  });

  it("is trusted by --label-present in a local run, with no API", async () => {
    const done = await run({}, undefined, ["old", "new", "--label-present"]);
    expect(done.code).toBe(0);
    expect(done.out).toContain("a local run");
  });
});

describe("the API the workflow gives the command", () => {
  it("is there only with a token, a repository and a pull request number", () => {
    expect(apiOf(WORKFLOW)).toBeDefined();
    for (const lack of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "PR_NUMBER"]) {
      const env = Object.fromEntries(Object.entries(WORKFLOW).filter(([key]) => key !== lack));
      expect(apiOf(env)).toBeUndefined();
    }
    expect(apiOf({ ...WORKFLOW, GITHUB_TOKEN: "" })).toBeUndefined();
  });
});
