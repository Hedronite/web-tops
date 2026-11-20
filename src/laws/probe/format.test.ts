import { describe, expect, it } from "vitest";
import { probeExit, probeText } from "./format.ts";
import type { LawProbe, ProbeReport } from "./types.ts";

const PASS: LawProbe = { id: "W-01", verdict: "pass", failures: [], unrelated: [] };
const FAIL: LawProbe = {
  id: "W-02",
  verdict: "fail",
  failures: [
    { kind: "silent", message: "W-02/bad/a.ts:1 stayed quiet: r did not fire on its bad twin" },
    { kind: "noisy", message: "W-02/clean/a.ts:3 fired r on its clean twin" },
  ],
  unrelated: [{ file: "W-02/bad/a.ts", line: 2, rule: "x" }],
};

describe("G3b the probe's text and exit code", () => {
  it("prints a line for each law, its failures under it, and how many pass", () => {
    const report: ProbeReport = { laws: [PASS, FAIL], skipped: [] };
    expect(probeText(report)).toBe(
      [
        "W-01  pass",
        "W-02  fail",
        "  W-02/bad/a.ts:1 stayed quiet: r did not fire on its bad twin",
        "  W-02/clean/a.ts:3 fired r on its clean twin",
        "  1 finding(s) on its twins that no rule of the law explains",
        "1 of 2 laws probed pass",
        "",
      ].join("\n"),
    );
  });

  it("says nothing about unrelated findings when there are none", () => {
    expect(probeText({ laws: [PASS], skipped: [] })).toBe("W-01  pass\n1 of 1 laws probed pass\n");
  });

  it("counts no law as 0 of 0, and exits 0 for it: there is nothing that fails", () => {
    expect(probeText({ laws: [], skipped: [] })).toBe("0 of 0 laws probed pass\n");
    expect(probeExit({ laws: [], skipped: [] })).toBe(0);
  });

  it("exits 0 when every law passes and 1 when any fails", () => {
    expect(probeExit({ laws: [PASS, PASS], skipped: [] })).toBe(0);
    expect(probeExit({ laws: [PASS, FAIL], skipped: [] })).toBe(1);
    expect(probeExit({ laws: [FAIL], skipped: [] })).toBe(1);
  });

  it("names each skipped twin with its reason, after the laws and before the count", () => {
    const reason = "the ui-components preset does not lint .astro files";
    const skipped = [
      { law: "W-22", kind: "bad" as const, file: "W-22/bad/a.astro", reason },
      { law: "W-22", kind: "clean" as const, file: "W-22/clean/a.astro", reason },
    ];
    expect(probeText({ laws: [PASS], skipped })).toBe(
      [
        "W-01  pass",
        `skipped W-22/bad/a.astro: ${reason}`,
        `skipped W-22/clean/a.astro: ${reason}`,
        "1 of 1 laws probed pass",
        "",
      ].join("\n"),
    );
  });
});
