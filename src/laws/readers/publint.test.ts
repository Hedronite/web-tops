import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { judgePublint, publintReader, readPublint } from "./publint.ts";
import { inputFor, lawOf } from "./testkit.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const LAW = lawOf("W-18", [{ tool: "publint", name: "publint" }]);

describe("readPublint", () => {
  it("reads the exit code and the errors", () => {
    expect(readPublint('{"code":1,"errors":["a","b"]}')).toEqual({ code: 1, errors: ["a", "b"] });
  });

  it("keeps only the errors that are text, and reads a code that is null", () => {
    expect(readPublint('{"code":null,"errors":["a",1,null]}')).toEqual({
      code: null,
      errors: ["a"],
    });
  });

  it("reads a report with no errors list as having none", () => {
    expect(readPublint('{"code":0}')).toEqual({ code: 0, errors: [] });
  });

  it.each([undefined, "", "not json", "[]", "{}", '{"code":"1"}'])(
    "is undefined for %j",
    (text) => {
      expect(readPublint(text)).toBeUndefined();
    },
  );
});

describe("judgePublint", () => {
  it("refuses a law for each error publint listed", () => {
    expect(judgePublint(LAW, { code: 1, errors: ["a", "b"] }, false)).toEqual({
      law: "W-18",
      verdict: "refuse",
      findings: [
        { tool: "publint", rule: "publint", verdict: "refuse", message: "a" },
        { tool: "publint", rule: "publint", verdict: "refuse", message: "b" },
      ],
    });
  });

  it("passes a publint that exited 0 with no error", () => {
    expect(judgePublint(LAW, { code: 0, errors: [] }, false)).toEqual({
      law: "W-18",
      verdict: "pass",
      findings: [],
    });
  });

  it("holds the errors under a ratchet baseline", () => {
    expect(judgePublint(LAW, { code: 1, errors: ["a"] }, true)).toMatchObject({
      verdict: "pass",
      note: "1 held by the baseline",
    });
  });

  it("is not evaluated for a publint that failed and said nothing a reader can use", () => {
    expect(judgePublint(LAW, { code: 2, errors: [] }, false)).toEqual({
      law: "W-18",
      verdict: "not-evaluated",
      reason: "publint exited 2 and listed no error",
      findings: [],
    });
  });

  it("is not evaluated with no report: the package step did not run", () => {
    expect(judgePublint(LAW, undefined, false)).toEqual({
      law: "W-18",
      verdict: "not-evaluated",
      reason: "gate 1 kept no publint report: the package step did not run, or publint could not",
      findings: [],
    });
  });
});

describe("publintReader", () => {
  it("reads the report gate 1 kept, and is not evaluated without one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-publint-"));
    roots.push(dir);
    writeFileSync(join(dir, "publint.json"), '{"code":1,"errors":["a"]}');
    const read = await publintReader(
      inputFor([LAW], { artifacts: { "publint-json": join(dir, "publint.json") } }),
    );
    expect(read[0]?.verdict).toBe("refuse");
    expect((await publintReader(inputFor([LAW])))[0]?.verdict).toBe("not-evaluated");
  });
});
