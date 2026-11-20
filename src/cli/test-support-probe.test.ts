import { afterAll, describe, expect, it } from "vitest";
import { cli, statusOf, NO_EXEC, probeFrom } from "./test-support-probe.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";

describe("G3 the probe test helpers", () => {
  it("NO_EXEC refuses to run a tool, saying so", async () => {
    await expect(NO_EXEC("eslint", [])).rejects.toThrow("no tool should run");
  });

  it("a process a signal ended has no exit code: -1; one that exited keeps its code", () => {
    expect([statusOf(null), statusOf(0), statusOf(3)]).toEqual([-1, 0, 3]);
  });

  it("reads a report the probe printed, with the exit code", () => {
    const report = { laws: [{ id: "W-01", verdict: "pass", failures: [], unrelated: [] }] };
    expect(probeFrom({ code: 0, out: JSON.stringify(report), err: "" })).toEqual({
      code: 0,
      report,
    });
  });

  it("an output that is not a report is an error: not an object, no laws, laws not an array", () => {
    for (const out of ["null", "3", "{}", '{"laws": "x"}', "[]"]) {
      expect(() => probeFrom({ code: 0, out, err: "" }), out).toThrow(
        "the probe printed no report",
      );
    }
  });

  it("anything on stderr fails the read before the output is looked at", () => {
    expect(() => probeFrom({ code: 0, out: "{}", err: "warning" })).toThrow();
  });

  it("a command run with no probe given refuses to probe, saying so", async () => {
    const one = (): readonly { id: string; proofs: readonly string[] }[] => [
      { id: "W-01", proofs: [] },
    ];
    await expect(cli(["--law", "W-01"], tempDir(), { laws: one })).rejects.toThrow(
      "no probe should run",
    );
  });
});

afterAll(cleanTemp);
