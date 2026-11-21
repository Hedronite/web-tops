import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Runner } from "../census/eslint.ts";
import type { Exec } from "../gate/types.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";
import { askStyle, configNames } from "./style.ts";

afterAll(cleanTemp);

const printed = JSON.stringify({
  rules: { "a.css": { "color-no-invalid-hex": { level: 2, options: "[]" } } },
});

function runner(exec: Exec): Runner {
  return { cwd: "/proj", env: { A: "1" }, exec, outDir: join(tempDir(), "out") };
}

describe("the files Stylelint looks for", () => {
  it("are .stylelintrc, with each extension, and stylelint.config with each extension", () => {
    const names = configNames();
    expect(names).toHaveLength(19);
    expect(names.slice(0, 3)).toEqual([".stylelintrc", ".stylelintrc.json", ".stylelintrc.yaml"]);
    expect(names).toContain("stylelint.config.mjs");
    expect(names).toContain(".stylelintrc.cts");
    expect(names.slice(-1)).toEqual(["stylelint.config.cts"]);
  });
});

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly list: unknown;
  readonly marker: string | undefined;
}

const envOf = (options: { env?: Record<string, string | undefined> } | undefined) =>
  options?.env ?? {};

function recorder(calls: Call[]): Exec {
  return (command, args, options) => {
    const env = envOf(options);
    const list: unknown = JSON.parse(readFileSync(String(env["WEBTOPS_LAWDIFF_FILES"]), "utf8"));
    calls.push({ command, args, list, marker: env["A"] });
    return Promise.resolve({ code: 0, stdout: printed, stderr: "" });
  };
}

const says =
  (code: number | null, stdout: string, stderr = "", failure?: "tool-timeout"): Exec =>
  () =>
    Promise.resolve(
      failure === undefined ? { code, stdout, stderr } : { code, stdout, stderr, failure },
    );

describe("asking the checkout's Stylelint", () => {
  it("runs one process under node from the checkout with the files it was given", async () => {
    const calls: Call[] = [];
    const read = await askStyle(runner(recorder(calls)), ["a.css", "b.css"]);
    expect(read.ok).toBe(true);
    expect(calls).toMatchObject([{ command: "node", list: ["a.css", "b.css"], marker: "1" }]);
    const args = calls.flatMap((call) => call.args);
    expect(args.slice(0, 2)).toEqual(["--input-type=module", "-e"]);
    expect(args[2]).toContain("resolveConfig");
    expect(args[2]).toContain("codeFilename");
  });

  it("reads what Stylelint prints", async () => {
    const read = await askStyle(runner(says(0, printed)), []);
    expect(read.ok ? [...read.value.keys()] : []).toEqual(["a.css"]);
  });

  it("says why when Stylelint cannot be run, exits non-zero, or prints something else", async () => {
    expect(await askStyle(runner(says(2, "", "a\nb\nc\nd")), [])).toEqual({
      ok: false,
      message: "Stylelint could not be asked about the project's files (exit 2: b c d)",
    });
    expect(await askStyle(runner(says(null, "", "", "tool-timeout")), [])).toEqual({
      ok: false,
      message: "Stylelint could not be asked about the project's files (tool-timeout)",
    });
    expect(await askStyle(runner(says(0, "nope")), [])).toEqual({
      ok: false,
      message: "Stylelint printed something that is not its rules",
    });
  });
});
