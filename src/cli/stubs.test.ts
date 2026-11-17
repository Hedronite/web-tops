import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fixturesDir } from "../config/test-support.ts";
import { run } from "./main.ts";

// R1 stubs. The step that builds a command deletes its row here, with the stub.

const root = resolve(import.meta.dirname, "../..");

describe("R1 stubs: a command another step builds", () => {
  it.each([
    ["report", "G6"],
    ["lock", "G6"],
    ["doctor", "G6"],
  ])("%s prints that it lands in %s, to stderr, and exits 1", async (name, step) => {
    let out = "";
    let err = "";
    const code = await run([name, "--anything"], {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
      cwd: fixturesDir,
      env: {},
    });
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe(`${name}: lands in ${step}\n`);
  });

  it("exits 1 through bun src/cli/main.ts", () => {
    const result = spawnSync("bun", ["src/cli/main.ts", "doctor"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("doctor: lands in G6\n");
  });
});
