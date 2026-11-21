import { describe, expect, it } from "vitest";
import { exitCodeOf, gaveAnswer, notEvaluated, rulesOf, saidOf } from "./reading.ts";
import { lawOf } from "./testkit.ts";

const result = (code: number | null, stdout = "", stderr = "") => ({
  code,
  stdout,
  stderr,
});

describe("rulesOf", () => {
  it("names the rules of one tool, and no other tool's", () => {
    const law = lawOf("W-01", [
      { tool: "knip", name: "files" },
      { tool: "secretlint", name: "preset" },
      { tool: "knip", name: "exports" },
    ]);
    expect(rulesOf(law, "knip")).toEqual(["files", "exports"]);
    expect(rulesOf(law, "audit")).toEqual([]);
  });
});

describe("gaveAnswer", () => {
  it.each([
    [0, true],
    [1, true],
    [2, false],
    [127, false],
    [null, false],
  ])("is the answer of a scanner that ended %j: %j", (code, answered) => {
    expect(gaveAnswer(result(code))).toBe(answered);
  });
});

describe("exitCodeOf", () => {
  it.each([
    [3, 3],
    [null, null],
    ["3", undefined],
    [undefined, undefined],
  ])("reads %j as %j", (value, code) => {
    expect(exitCodeOf(value)).toBe(code);
  });
});

describe("saidOf", () => {
  it("is what a tool said on stderr, else on stdout", () => {
    expect(saidOf(result(2, "out", "err"))).toBe("err");
    expect(saidOf(result(2, "out", ""))).toBe("out");
  });
});

describe("notEvaluated", () => {
  it("is a reading that judged nothing and says why", () => {
    expect(notEvaluated(lawOf("W-01", []), "no report")).toMatchObject({
      law: "W-01",
      verdict: "not-evaluated",
      findings: [],
    });
  });
});
