import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { fixturesDir } from "../config/test-support.ts";
import { runVersionCli } from "./version.ts";

// The first two lines are the protocol and the package version. Later steps add a line per pinned
// tool, so nothing here may pin the total line count.

const root = resolve(import.meta.dirname, "../..");

function firstLines(text: string): string[] {
  return text.split("\n").slice(0, 2);
}

describe("webtops version", () => {
  it("prints the protocol, then the package version, and exits 0", async () => {
    let out = "";
    let err = "";
    const code = await runVersionCli([], {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
      cwd: fixturesDir,
      env: {},
    });
    expect(code).toBe(0);
    expect(firstLines(out)).toEqual(["protocol 0.2.1", `package ${pkg.version}`]);
    expect(out.endsWith("\n")).toBe(true);
    expect(err).toBe("");
  });

  it("is the same through bun src/cli/main.ts version", () => {
    const result = spawnSync("bun", ["src/cli/main.ts", "version"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(firstLines(result.stdout)).toEqual(["protocol 0.2.1", `package ${pkg.version}`]);
  });
});
