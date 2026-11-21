import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attwReader, judgeAttw, readAttw } from "./attw.ts";
import { inputFor, lawOf } from "./testkit.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const LAW = lawOf("W-18", [{ tool: "attw", name: "attw" }]);

describe("readAttw", () => {
  it("reads the exit code and each problem with its kind and entry point", () => {
    const text =
      '{"code":1,"problems":[{"kind":"NoResolution","entrypoint":"."},{"kind":"FalseCJS","entrypoint":"./react"}]}';
    expect(readAttw(text)).toEqual({
      code: 1,
      problems: [
        { kind: "NoResolution", entrypoint: "." },
        { kind: "FalseCJS", entrypoint: "./react" },
      ],
    });
  });

  it("names a kind or an entry point that is missing `?`, and skips a problem that is not a record", () => {
    expect(readAttw('{"code":null,"problems":[{},"odd"]}')).toEqual({
      code: null,
      problems: [{ kind: "?", entrypoint: "?" }],
    });
  });

  it("reads a report with no problem list as having none", () => {
    expect(readAttw('{"code":0}')).toEqual({ code: 0, problems: [] });
  });

  it.each([undefined, "", "not json", "[]", "{}", '{"code":"1"}'])(
    "is undefined for %j",
    (text) => {
      expect(readAttw(text)).toBeUndefined();
    },
  );
});

describe("judgeAttw", () => {
  const problems = [
    { kind: "NoResolution", entrypoint: "." },
    { kind: "FalseCJS", entrypoint: "./react" },
  ];

  it("refuses a law for each problem attw found, by its kind", () => {
    expect(judgeAttw(LAW, { code: 1, problems }, false)).toEqual({
      law: "W-18",
      verdict: "refuse",
      findings: [
        { tool: "attw", rule: "attw:NoResolution", verdict: "refuse", message: "entrypoint ." },
        { tool: "attw", rule: "attw:FalseCJS", verdict: "refuse", message: "entrypoint ./react" },
      ],
    });
  });

  it("passes an attw that exited 0 with no problem", () => {
    expect(judgeAttw(LAW, { code: 0, problems: [] }, false)).toEqual({
      law: "W-18",
      verdict: "pass",
      findings: [],
    });
  });

  it("holds the problems under a ratchet baseline", () => {
    expect(judgeAttw(LAW, { code: 1, problems }, true)).toMatchObject({
      verdict: "pass",
      note: "2 held by the baseline",
    });
  });

  it("is not evaluated for an attw that failed and listed no problem", () => {
    expect(judgeAttw(LAW, { code: 3, problems: [] }, false)).toEqual({
      law: "W-18",
      verdict: "not-evaluated",
      reason: "attw exited 3 and listed no problem",
      findings: [],
    });
  });

  it("is not evaluated with no report: the package step did not run", () => {
    expect(judgeAttw(LAW, undefined, false)).toEqual({
      law: "W-18",
      verdict: "not-evaluated",
      reason: "gate 1 kept no attw report: the package step did not run, or attw could not",
      findings: [],
    });
  });
});

describe("attwReader", () => {
  it("reads the report gate 1 kept, and is not evaluated without one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-attw-"));
    roots.push(dir);
    writeFileSync(
      join(dir, "attw.json"),
      '{"code":1,"problems":[{"kind":"NoResolution","entrypoint":"."}]}',
    );
    const read = await attwReader(
      inputFor([LAW], { artifacts: { "attw-json": join(dir, "attw.json") } }),
    );
    expect(read[0]?.verdict).toBe("refuse");
    expect((await attwReader(inputFor([LAW])))[0]?.verdict).toBe("not-evaluated");
  });
});
