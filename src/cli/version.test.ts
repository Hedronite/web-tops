import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { fixturesDir } from "../config/test-support.ts";
import { TOOL_PINS } from "../lock/pins.ts";
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

  it("then lists every pinned tool at its exact version, sorted, one per line", async () => {
    let out = "";
    await runVersionCli([], {
      out: (text) => {
        out += text;
      },
      err: () => undefined,
      cwd: fixturesDir,
      env: {},
    });
    const lines = out
      .split("\n")
      .slice(2)
      .filter((line) => line !== "");
    for (const [tool, version] of Object.entries(TOOL_PINS))
      expect(lines).toContain(`${tool} ${version}`);
    const names = lines.map((line) => line.split(" ")[0]);
    expect(names).toEqual([...names].sort());
    expect(names.length).toBe(Object.keys(TOOL_PINS).length);
  });

  it("exits 2 on an argument", async () => {
    let err = "";
    const code = await runVersionCli(["--json"], {
      out: () => undefined,
      err: (text) => {
        err += text;
      },
      cwd: fixturesDir,
      env: {},
    });
    expect(code).toBe(2);
    expect(err).toContain("takes no arguments");
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
