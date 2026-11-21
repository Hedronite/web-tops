import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Runner } from "../census/eslint.ts";
import type { Exec } from "../gate/types.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";
import { askStyle, configNames } from "./style.ts";

afterAll(cleanTemp);

describe("the files Stylelint looks for", () => {
  it("are, in order, .stylelintrc, then .stylelintrc and stylelint.config with each extension", () => {
    const extensions = ["json", "yaml", "yml", "js", "cjs", "mjs", "ts", "mts", "cts"];
    expect(configNames()).toEqual([
      ".stylelintrc",
      ...extensions.map((extension) => `.stylelintrc.${extension}`),
      ...extensions.map((extension) => `stylelint.config.${extension}`),
    ]);
  });
});

function runner(exec: Exec): Runner {
  return { cwd: "/p", env: {}, exec, outDir: join(tempDir(), "out") };
}

describe("asking Stylelint", () => {
  it("gives it five minutes, and writes the file list in a folder of its own under the output folder", async () => {
    const seen: (number | undefined)[] = [];
    const made = runner((_command, _args, options) => {
      seen.push(options?.timeoutMs);
      return Promise.resolve({ code: 0, stdout: '{ "rules": {} }', stderr: "" });
    });
    await askStyle(made, ["a.css"]);
    expect(seen).toEqual([300_000]);
    expect(existsSync(join(made.outDir, "lawdiff", "stylelint-files.json"))).toBe(true);
  });

  it("names the last three lines it said, without the blank one a final newline leaves", async () => {
    const exits: Exec = () => Promise.resolve({ code: 2, stdout: "", stderr: "a\nb\nc\nd\n" });
    const read = await askStyle(runner(exits), []);
    expect(read.ok ? "" : read.message).toBe(
      "Stylelint could not be asked about the project's files (exit 2: b c d)",
    );
  });

  it("fails on a failure it reports even when its exit code was 0", async () => {
    const exec: Exec = () =>
      Promise.resolve({ code: 0, stdout: '{ "rules": {} }', stderr: "", failure: "tool-missing" });
    const read = await askStyle(runner(exec), []);
    expect(read.ok ? "" : read.message).toBe(
      "Stylelint could not be asked about the project's files (tool-missing)",
    );
  });
});
