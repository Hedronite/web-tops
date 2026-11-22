import { describe, expect, it } from "vitest";
import type { ExecResult } from "../../gate/types.ts";
import { OUT_LINES, strykerFailed, strykerTrouble, VACUOUS } from "./failed.ts";

/** What a failed Stryker run shows: its exit code or signal, and the tail of stdout, where its reason is. */

const ran = (over: Partial<ExecResult>): ExecResult => ({
  code: 1,
  stdout: "",
  stderr: "",
  ...over,
});

describe("the finding for a Stryker run that wrote no report", () => {
  it("names the rule and the tool, and the exit code with what stderr said", () => {
    const finding = strykerFailed(ran({ code: 1, stderr: "dry run failed: boom\n" }));
    expect(finding).toMatchObject({ rule: "stryker-failed", tool: "stryker", verdict: "fail" });
    expect(finding.message).toBe("stryker exited 1: dry run failed: boom");
  });

  it("names the signal that ended it, and no exit code", () => {
    const message = strykerFailed(ran({ code: null, signal: "SIGKILL" })).message;
    expect(message).toBe("stryker was ended by SIGKILL: ");
    expect(message).not.toContain("exited");
  });

  it("quotes the last 30 lines of stdout and no earlier line", () => {
    const stdout = Array.from({ length: 45 }, (_, index) => `line ${String(index + 1)}`).join("\n");
    const message = strykerFailed(ran({ stdout: `${stdout}\n` })).message;
    expect(OUT_LINES).toBe(30);
    expect(message).toContain("stdout (last 30 lines):\nline 16\n");
    expect(message.endsWith("\nline 45")).toBe(true);
    expect(message).not.toContain("line 15\n");
    expect(message.split("\n").filter((line) => line.startsWith("line "))).toHaveLength(30);
  });

  it("carries the reason Stryker prints on stdout when stderr is empty", () => {
    const stdout = "An error occurred outside of a test run\nsrc/a.test.ts failed";
    const message = strykerFailed(ran({ code: 1, stdout })).message;
    expect(message).toContain("An error occurred outside of a test run");
    expect(message).toContain("src/a.test.ts failed");
  });

  it("adds no stdout section when stdout is blank", () => {
    const message = strykerFailed(ran({ code: 2, stderr: "boom", stdout: " \n" })).message;
    expect(message).toBe("stryker exited 2: boom");
  });
});

describe("what stops a Stryker run from having a report", () => {
  it("is nothing when Stryker exited 0", () => {
    expect(strykerTrouble(ran({ code: 0, stdout: "ok", stderr: "warn" }))).toBeUndefined();
  });

  it("is a launch failure, naming Stryker, when it could not start and printed nothing", () => {
    const finding = strykerTrouble(ran({ code: null, failure: "tool-missing" }));
    expect(finding).toMatchObject({ rule: "tool-missing", tool: "stryker" });
    expect(finding?.message).toBe("stryker is not installed or not on PATH");
  });

  it("is that launch failure with what the runner said, and not a failed run, when it could not start", () => {
    const finding = strykerTrouble(
      ran({
        code: null,
        stderr: "node is not on PATH, so stryker cannot run",
        failure: "tool-missing",
      }),
    );
    expect(finding?.rule).toBe("tool-missing");
    expect(finding?.message).toBe("node is not on PATH, so stryker cannot run");
  });

  it("is the failed run, with its stdout, when it exited non-zero", () => {
    const finding = strykerTrouble(ran({ code: 2, stderr: "boom", stdout: "why" }));
    expect(finding).toMatchObject({ rule: "stryker-failed", tool: "stryker" });
    expect(finding?.message).toBe("stryker exited 2: boom\nstdout (last 30 lines):\nwhy");
  });
});

describe("what a vacuous run says", () => {
  it("is that no source file or function is in scope to mutate", () => {
    expect(VACUOUS).toBe("no source file or function is in scope to mutate");
  });
});
