import { describe, expect, it } from "vitest";
import { realExec } from "./exec.ts";

describe("realExec", () => {
  it("captures stdout, stderr and the exit code", async () => {
    const result = await realExec(process.execPath, [
      "-e",
      "console.log('out'); console.error('err'); process.exit(3)",
    ]);
    expect(result).toMatchObject({ code: 3, stdout: "out\n", stderr: "err\n" });
    expect(result.failure).toBeUndefined();
  });

  it("reports a missing tool as tool-missing rather than throwing", async () => {
    const result = await realExec("webtops-no-such-tool", []);
    expect(result).toMatchObject({ code: null, failure: "tool-missing" });
  });

  it("kills a process that outlives its timeout and reports tool-timeout", async () => {
    const result = await realExec(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
      timeoutMs: 150,
    });
    expect(result.failure).toBe("tool-timeout");
  });

  it("passes cwd and env to the child, and an undefined env value removes the variable", async () => {
    const result = await realExec(
      process.execPath,
      ["-e", "console.log(process.env.WT_PROBE ?? 'unset', process.cwd())"],
      {
        cwd: "/",
        env: { ...process.env, WT_PROBE: "set" },
      },
    );
    expect(result.stdout).toBe("set /\n");
    const removed = await realExec(
      process.execPath,
      ["-e", "console.log(process.env.WT_PROBE ?? 'unset')"],
      {
        env: { PATH: process.env["PATH"], WT_PROBE: undefined },
      },
    );
    expect(removed.stdout).toBe("unset\n");
  });
});

describe("realExec: the child's standard input", () => {
  it("is closed, so a tool that reads it to the end finishes instead of waiting for input", async () => {
    const script = "process.stdin.resume(); process.stdin.on('end', () => console.log('eof'));";
    const result = await realExec(process.execPath, ["-e", script], { timeoutMs: 20000 });
    expect(result).toMatchObject({ code: 0, stdout: "eof\n" });
    expect(result.failure).toBeUndefined();
  });
});
