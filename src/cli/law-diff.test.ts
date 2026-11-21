import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec, ExecResult } from "../gate/types.ts";
import { cleanTemp } from "../laws/probe/testkit.ts";
import type { Io } from "./io.ts";
import { runLawDiffCli } from "./law-diff.ts";

afterAll(cleanTemp);

const REPO = resolve(import.meta.dirname, "../..");
const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });

function streams(env: Record<string, string> = {}): {
  io: Io;
  out: () => string;
  err: () => string;
} {
  let out = "";
  let err = "";
  return {
    io: {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
      cwd: REPO,
      env,
    },
    out: () => out,
    err: () => err,
  };
}

function tree(dir: string, strict: boolean): void {
  mkdirSync(dir);
  const options = `{ "strict": ${String(strict)} }`;
  writeFileSync(join(dir, "tsconfig.json"), `{ "compilerOptions": ${options}, "include": [] }\n`);
}

const isCheckout = (args: readonly string[]): boolean =>
  args[0] === "worktree" && args[1] === "add";

/** A git that has two refs, `old` with strict on (unless `strictBase` is false) and `new` with it off, each a folder of tsconfig. */
function twoRefs(strictBase = true): Exec {
  return (_command, args) => {
    if (isCheckout(args)) tree(String(args[4]), args[5] === "old" && strictBase);
    return Promise.resolve(args[0] === "merge-base" ? ok("old\n") : ok());
  };
}

/** `twoRefs` with an ESLint config in each checkout, so each is asked about its files. */
function withEslint(inner: Exec): Exec {
  return (command, args, options) => {
    const done = inner(command, args, options);
    if (command === "git" && args[0] === "worktree" && args[1] === "add") {
      writeFileSync(join(String(args[4]), "eslint.config.js"), "export default [];\n");
    }
    return done;
  };
}

const usage = "usage: webtops law-diff <base> <head> [--json] [--label-present]";

describe("webtops law-diff", () => {
  it("exits 2 with the usage when it is not given exactly a base and a head, or a flag it does not know", async () => {
    for (const argv of [[], ["a"], ["a", "b", "c"], ["a", "b", "--nope"]]) {
      const run = streams();
      expect(await runLawDiffCli(argv, run.io, twoRefs())).toBe(2);
      expect(run.out()).toBe("");
      expect(run.err()).toContain(usage);
      expect(run.err().startsWith("webtops law-diff: ")).toBe(true);
    }
  });

  it("refuses a ref that starts with a dash before it asks git anything, exit 2", async () => {
    for (const argv of [
      ["--oops", "b"],
      ["a", "-b"],
      ["-a", "-b"],
    ]) {
      let asked = 0;
      const exec: Exec = () => {
        asked += 1;
        return Promise.resolve(ok());
      };
      const run = streams();
      expect(await runLawDiffCli(argv, run.io, exec)).toBe(2);
      expect(asked).toBe(0);
    }
    const run = streams();
    await runLawDiffCli(["a", "-b"], run.io, twoRefs());
    expect(run.err()).toBe(`webtops law-diff: a ref cannot start with a dash\n${usage}\n`);
  });

  it("words the usage problem exactly, usage on its own line", async () => {
    const run = streams();
    expect(await runLawDiffCli(["a"], run.io, twoRefs())).toBe(2);
    expect(run.err()).toBe(`webtops law-diff: law-diff takes a base and a head\n${usage}\n`);
  });

  it("reads each checkout with a folder of its own for ESLint's file list, inside the checkout", async () => {
    const seen: boolean[] = [];
    const exec: Exec = (command, args, options) => {
      if (command === "node") {
        const dir = String(options?.cwd);
        seen.push(existsSync(join(dir, ".web-tops", "out", "lawdiff", "eslint-files.json")));
        return Promise.resolve(ok(JSON.stringify({ rules: {} })));
      }
      return twoRefs()(command, args, options);
    };
    const run = streams();
    await runLawDiffCli(["main", "new"], run.io, withEslint(exec));
    expect(seen).toEqual([true, true]);
  });

  it("exits 2 and says why when the refs have no merge base", async () => {
    const run = streams();
    const exec: Exec = () => Promise.resolve({ code: 1, stdout: "", stderr: "fatal: no" });
    expect(await runLawDiffCli(["a", "b"], run.io, exec)).toBe(2);
    expect(run.err()).toBe("webtops law-diff: no merge base of a and b: fatal: no\n");
  });

  it("exits 1 and lists the flag that was dropped, when the head is weaker than its merge base", async () => {
    const run = streams();
    expect(await runLawDiffCli(["main", "new"], run.io, twoRefs())).toBe(1);
    expect(run.out()).toContain(
      "compiler flags: 17 compared, 10 weakened, 0 strengthened, 0 changed",
    );
    expect(run.out()).toContain("weakened: tsconfig.json: strict: true -> false");
    expect(run.out()).toContain("not excused, the protocol-change label is absent");
    expect(run.err()).toBe("");
  });

  it("exits 0 for the same diff when the label is present, as a flag or as the workflow's variable", async () => {
    const flagged = streams();
    expect(await runLawDiffCli(["main", "new", "--label-present"], flagged.io, twoRefs())).toBe(0);
    expect(flagged.out()).toContain("excused, the protocol-change label is present");
    const environment = streams({ WEBTOPS_PROTOCOL_CHANGE_LABEL: "1" });
    expect(await runLawDiffCli(["main", "new"], environment.io, twoRefs())).toBe(0);
    const other = streams({ WEBTOPS_PROTOCOL_CHANGE_LABEL: "0" });
    expect(await runLawDiffCli(["main", "new"], other.io, twoRefs())).toBe(1);
  });

  it("prints JSON under --json, and exits 0 with nothing weakened when the head is not weaker", async () => {
    const run = streams();
    expect(await runLawDiffCli(["main", "new", "--json"], run.io, twoRefs(false))).toBe(0);
    const parsed: unknown = JSON.parse(run.out());
    expect(parsed).toMatchObject({ base: "main", head: "new", mergeBase: "old", weakened: 0 });
  });
});
