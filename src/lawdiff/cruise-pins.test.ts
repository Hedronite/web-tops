import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Runner } from "../census/eslint.ts";
import type { Exec } from "../gate/types.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";
import { askCruise, cruiseOf } from "./cruise.ts";

afterAll(cleanTemp);

function runner(exec: Exec): Runner {
  return { cwd: "/p", env: {}, exec, outDir: join(tempDir(), "out") };
}

describe("the rules of a config with entries that are not objects", () => {
  it("skips a null, a number or a string among the rules instead of reading it", () => {
    const found = cruiseOf({ forbidden: [null, 5, "x"], required: [null], allowed: [null] });
    expect([...(found?.values.keys() ?? [])]).toEqual(["allowedSeverity"]);
    expect(found?.allowed).toEqual(["null"]);
  });

  it("holds a required rule with no name beside the forbidden ones, and a named required one by its name", () => {
    const found = cruiseOf({
      forbidden: [{ from: {} }],
      required: [
        { severity: "error", module: {} },
        { name: "needs", severity: "error" },
      ],
    });
    expect(found?.allowed).toEqual([
      'forbidden: {"from":{}}',
      'required: {"severity":"error","module":{}}',
    ]);
    expect(found?.values.get("required: needs")).toEqual({ shown: "error", rank: 3 });
  });
});

describe("asking dependency-cruiser", () => {
  it("gives it five minutes, and writes its script in a folder of its own under the output folder", async () => {
    const seen: (number | undefined)[] = [];
    const made = runner((_command, _args, options) => {
      seen.push(options?.timeoutMs);
      return Promise.resolve({ code: 0, stdout: "{}", stderr: "" });
    });
    await askCruise(made, ".dependency-cruiser.cjs");
    expect(seen).toEqual([300_000]);
    expect(existsSync(join(made.outDir, "lawdiff", "cruise.mjs"))).toBe(true);
  });

  it("names the last three lines it said, without the blank one a final newline leaves", async () => {
    const exits: Exec = () => Promise.resolve({ code: 1, stdout: "", stderr: "a\nb\nc\nd\n" });
    const read = await askCruise(runner(exits), "c.cjs");
    expect(read.ok ? "" : read.message).toBe(
      "dependency-cruiser's config could not be read (exit 1: b c d)",
    );
  });

  it("fails on a failure it reports even when its exit code was 0", async () => {
    const exec: Exec = () =>
      Promise.resolve({ code: 0, stdout: "{}", stderr: "", failure: "tool-missing" });
    const read = await askCruise(runner(exec), "c.cjs");
    expect(read.ok ? "" : read.message).toBe(
      "dependency-cruiser's config could not be read (tool-missing)",
    );
  });
});
