import { ChildProcess, execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { killTree, realExec } from "./exec.ts";

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

describe("realExec: timers and process groups", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A child that ignores SIGTERM and would live for a minute: only SIGKILL ends it. */
  const STUBBORN = "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60000);";

  it("kills a child that has no timeout at the ten-minute default, with a signal it cannot ignore", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const running = realExec(process.execPath, ["-e", STUBBORN]);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    const result = await running;
    expect(result.failure).toBe("tool-timeout");
  });

  it("does not kill a child with no timeout before the ten-minute default", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const running = realExec(process.execPath, [
      "-e",
      "setTimeout(() => console.log('done'), 300)",
    ]);
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    const result = await running;
    expect(result).toMatchObject({ code: 0, stdout: "done\n" });
  });

  it("kills the whole group of a child that has a timeout, with a signal it cannot ignore", async () => {
    const started = Date.now();
    const result = await realExec(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 5000);"],
      { timeoutMs: 300 },
    );
    expect(result.failure).toBe("tool-timeout");
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it("clears its timer when the process could not start", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await realExec("webtops-no-such-tool", []);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer when the process has finished", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await realExec(process.execPath, ["-e", "1"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  const GROUP =
    "console.log(require('child_process').execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim())";
  const groupOf = (pid: number): string =>
    execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim();

  it("keeps a run with no timeout in the caller's own process group, so a terminal's interrupt reaches it", async () => {
    const result = await realExec(process.execPath, ["-e", GROUP]);
    expect(result.stdout.trim()).toBe(groupOf(process.pid));
  });

  it("gives a run with a timeout a group of its own, so the whole tree can be killed", async () => {
    const result = await realExec(process.execPath, ["-e", GROUP], { timeoutMs: 20000 });
    expect(result.stdout.trim()).not.toBe(groupOf(process.pid));
  });
});

describe("killTree", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A child process that was never started, with the pid it is given and its kill watched. */
  const fakeChild = (pid: number | undefined): { child: ChildProcess; kill: Mock } => {
    const child = new ChildProcess();
    Object.defineProperty(child, "pid", { value: pid });
    return { child, kill: vi.spyOn(child, "kill").mockImplementation(() => true) };
  };

  it("kills the child alone, and never a process group, when it leads no group of its own", () => {
    const groups = vi.spyOn(process, "kill").mockImplementation(() => true);
    const { child, kill } = fakeChild(4242);
    killTree(child, false);
    expect(kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(groups).not.toHaveBeenCalled();
  });

  it("kills the child alone when it has no pid, even if it was meant to lead a group", () => {
    const groups = vi.spyOn(process, "kill").mockImplementation(() => true);
    const { child, kill } = fakeChild(undefined);
    killTree(child, true);
    expect(kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(groups).not.toHaveBeenCalled();
  });

  it("kills the whole group, by the negative of its pid, when the child leads one", () => {
    const groups = vi.spyOn(process, "kill").mockImplementation(() => true);
    const { child, kill } = fakeChild(4242);
    killTree(child, true);
    expect(groups).toHaveBeenCalledExactlyOnceWith(-4242, "SIGKILL");
    expect(kill).not.toHaveBeenCalled();
  });

  it("kills the child by itself when the group is already gone", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const { child, kill } = fakeChild(4242);
    killTree(child, true);
    expect(kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  });
});
