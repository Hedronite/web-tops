import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { fixturesDir } from "../config/test-support.ts";
import { runCheckCli } from "./check.ts";
import { runDoctorCli } from "./doctor.ts";
import { runGateCli } from "./gate.ts";
import { runInitCli } from "./init.ts";
import { stdio, type Io } from "./io.ts";
import { runLockCli } from "./lock.ts";
import { run } from "./main.ts";
import { runReportCli } from "./report.ts";
import { runVersionCli } from "./version.ts";

const root = resolve(import.meta.dirname, "../..");

function capture(cwd = root): { io: Io; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
    env: {},
  };
  return { io, out: () => out, err: () => err };
}

async function exec(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  const { io, out, err } = capture();
  const code = await run(argv, io);
  return { code, out: out(), err: err() };
}

function spawnCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["src/cli/main.ts", ...args], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("webtops version", () => {
  it("prints the protocol and the package version, and exits 0", async () => {
    const { code, out, err } = await exec(["version"]);
    expect(code).toBe(0);
    expect(out).toBe(`protocol 0.2.1\npackage ${pkg.version}\n`);
    expect(err).toBe("");
  });
});

describe("webtops with an unknown command", () => {
  it.each(["frobnicate", "constructor", "__proto__", "toString", "Version"])(
    "%s exits 2, names the command on stderr and prints nothing on stdout",
    async (name) => {
      const { code, out, err } = await exec([name]);
      expect(code).toBe(2);
      expect(out).toBe("");
      expect(err).toContain(`unknown command "${name}"`);
    },
  );

  it("exits 2 with a usage line when no command is given", async () => {
    const { code, out, err } = await exec([]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("usage: webtops <command>");
  });

  it("lists every M1 command in the usage line", async () => {
    const { err } = await exec([]);
    expect(err).toContain("commands: check, doctor, gate, init, lock, report, version");
  });
});

describe("R1 stubs: a command another step builds", () => {
  it.each([
    ["gate", "G2"],
    ["init", "G5"],
    ["report", "G6"],
    ["lock", "G6"],
    ["doctor", "G6"],
  ])("%s prints that it lands in %s, to stderr, and exits 1", async (name, step) => {
    const { code, out, err } = await exec([name, "--anything"]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe(`${name}: lands in ${step}\n`);
  });
});

describe("R15: every command module exports run<Name>Cli returning a Promise<number>", () => {
  it.each([
    ["runCheckCli", runCheckCli],
    ["runDoctorCli", runDoctorCli],
    ["runGateCli", runGateCli],
    ["runInitCli", runInitCli],
    ["runLockCli", runLockCli],
    ["runReportCli", runReportCli],
    ["runVersionCli", runVersionCli],
  ])("%s", async (_name, command) => {
    const result = command([], capture(fixturesDir).io);
    expect(result).toBeInstanceOf(Promise);
    expect(typeof (await result)).toBe("number");
  });

  it("run returns the number at once for a usage error and a promise for a command", async () => {
    const { io } = capture();
    expect(run(["frobnicate"], io)).toBe(2);
    const promised = run(["version"], io);
    expect(promised).toBeInstanceOf(Promise);
    expect(await promised).toBe(0);
  });

  it("run hands a command the arguments after its name, and the io it was given", async () => {
    const { io, err } = capture();
    expect(await run(["check", "--json"], io)).toBe(2);
    expect(err()).toContain("usage: webtops check [path]");
  });
});

describe("stdio", () => {
  it("writes out to stdout and err to stderr, and carries the process directory and environment", () => {
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
    expect(stdio.cwd).toBe(process.cwd());
    expect(stdio.env).toBe(process.env);
  });
});

describe("bun src/cli/main.ts", () => {
  it("version exits 0 and prints the protocol", () => {
    const { status, stdout } = spawnCli("version");
    expect(status).toBe(0);
    expect(stdout).toContain("protocol 0.2.1");
    expect(stdout).toContain(`package ${pkg.version}`);
  });

  it("an unknown command exits 2", () => {
    const { status, stderr } = spawnCli("frobnicate");
    expect(status).toBe(2);
    expect(stderr).toContain("frobnicate");
  });

  it("a stub exits 1", () => {
    const { status, stderr } = spawnCli("gate");
    expect(status).toBe(1);
    expect(stderr).toBe("gate: lands in G2\n");
  });

  it("check exits 0 on a valid config and 2 on an invalid one, with the pointer", () => {
    expect(spawnCli("check", "fixtures/config/valid/full.yaml").status).toBe(0);
    const bad = spawnCli("check", "fixtures/config/invalid/crap-cap-below-one.yaml");
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("/gates/crap/cap");
  });
});
