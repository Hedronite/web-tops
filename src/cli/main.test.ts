import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { run, stdio } from "./main";

const root = resolve(import.meta.dirname, "../..");

function exec(argv: readonly string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = run(argv, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

function spawnCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["src/cli/main.ts", ...args], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("webtops version", () => {
  it("prints the protocol and the package version, and exits 0", () => {
    const { code, out, err } = exec(["version"]);
    expect(code).toBe(0);
    expect(out).toBe(`protocol 0.2.0\npackage ${pkg.version}\n`);
    expect(err).toBe("");
  });
});

describe("webtops with an unknown command", () => {
  it("exits 2, names the command on stderr and prints nothing on stdout", () => {
    const { code, out, err } = exec(["frobnicate"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("frobnicate");
  });

  it("exits 2 with a usage line when no command is given", () => {
    const { code, out, err } = exec([]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("usage: webtops");
  });
});

describe("stdio", () => {
  it("writes out to stdout and err to stderr", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      stdio.out("to stdout");
      stdio.err("to stderr");
      expect(stdout).toHaveBeenCalledExactlyOnceWith("to stdout");
      expect(stderr).toHaveBeenCalledExactlyOnceWith("to stderr");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});

describe("bun src/cli/main.ts", () => {
  it("version exits 0 and prints the protocol", () => {
    const { status, stdout } = spawnCli("version");
    expect(status).toBe(0);
    expect(stdout).toContain("protocol 0.2.0");
    expect(stdout).toContain(`package ${pkg.version}`);
  });

  it("an unknown command exits 2", () => {
    const { status, stderr } = spawnCli("frobnicate");
    expect(status).toBe(2);
    expect(stderr).toContain("frobnicate");
  });
});
