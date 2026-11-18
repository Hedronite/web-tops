import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { killTree, realExec } from "./exec.ts";

/** G7b: a timeout kills the whole process tree, so a Stryker worker is not left running on a shared machine. */

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const SLEEP = "setTimeout(() => {}, 60000);";

describe("G7b realExec kills the children of a process it times out", () => {
  it("leaves no grandchild running", async () => {
    const script = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', '${SLEEP}'], { stdio: 'ignore' }); console.log(child.pid); ${SLEEP}`;
    const result = await realExec(process.execPath, ["-e", script], { timeoutMs: 1500 });
    expect(result.failure).toBe("tool-timeout");
    const pid = Number.parseInt(result.stdout.trim(), 10);
    expect(Number.isInteger(pid)).toBe(true);
    await new Promise((done) => setTimeout(done, 300));
    expect(alive(pid)).toBe(false);
  });
});

describe("G7b killTree", () => {
  it("kills a child that is not a group leader, by its own handle", async () => {
    const child = spawn(process.execPath, ["-e", SLEEP], { stdio: "ignore" });
    const closed = new Promise((done) => child.on("close", done));
    killTree(child, false);
    await closed;
    expect(child.signalCode).toBe("SIGKILL");
  });

  it("falls back to the child when its group is already gone", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore", detached: true });
    await new Promise((done) => child.on("close", done));
    expect(() => {
      killTree(child, true);
    }).not.toThrow();
  });

  it("leaves a child that never started alone", () => {
    const child = spawn("webtops-no-such-binary", [], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    expect(child.pid).toBeUndefined();
    expect(() => {
      killTree(child, true);
    }).not.toThrow();
  });
});
