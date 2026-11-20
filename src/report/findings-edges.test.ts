import { describe, expect, it } from "vitest";
import { completeFindings, fingerprint, type RawFinding } from "./findings.ts";

/** What makes a fingerprint: the parts it hashes, the order among repeats, and which findings repeat each other. */

const found = (extra: Partial<RawFinding> = {}): RawFinding => ({
  tool: "eslint",
  rule: "no-console",
  verdict: "fail",
  message: "no console",
  file: "src/a.ts",
  ...extra,
});

const noSource = (): undefined => undefined;

describe("a fingerprint", () => {
  it("is fp1 and 16 hex characters of the sha256 of its parts, joined by NUL", () => {
    const parts = {
      tool: "eslint",
      rule: "no-console",
      file: "src/a.ts",
      anchor: "x",
      occurrence: 1,
    };
    expect(fingerprint(parts)).toBe("fp1:f60399d1c94096d8");
    expect(fingerprint({ ...parts, file: null })).toBe("fp1:ce4ebab2c81aa1e8");
    expect(fingerprint({ ...parts, occurrence: 2 })).not.toBe(fingerprint(parts));
  });
});

describe("the order among repeats", () => {
  const fp = (rule: string, file: string | null, anchor: string, occurrence: number): string =>
    fingerprint({ tool: "eslint", rule, file, anchor, occurrence });

  it("counts each repeat by line, whatever order the tool listed them", () => {
    const lines = [5, 2, 9, 2];
    const raws = lines.map((line) => found({ line }));
    const done = completeFindings(raws, noSource);
    const expected = [3, 1, 4, 2].map((n) => fp("no-console", "src/a.ts", "no console", n));
    expect(done.map((item) => item.fingerprint)).toEqual(expected);
  });

  it("counts repeats within one tool, rule, file and anchor, and no wider", () => {
    const done = completeFindings(
      [
        found({ rule: "a" }),
        found({ rule: "b" }),
        found({ rule: "a", file: "src/b.ts" }),
        found({ rule: "a", message: "other" }),
        found({ rule: "a" }),
      ],
      noSource,
    );
    expect(done.map((item) => item.fingerprint)).toEqual([
      fp("a", "src/a.ts", "no console", 1),
      fp("b", "src/a.ts", "no console", 1),
      fp("a", "src/b.ts", "no console", 1),
      fp("a", "src/a.ts", "other", 1),
      fp("a", "src/a.ts", "no console", 2),
    ]);
  });

  it("keeps the parts of the key apart: a rule and a file that read the same joined are not repeats", () => {
    const done = completeFindings(
      [found({ rule: "ab", file: "c" }), found({ rule: "a", file: "bc" })],
      noSource,
    );
    expect(done.map((item) => item.fingerprint)).toEqual([
      fp("ab", "c", "no console", 1),
      fp("a", "bc", "no console", 1),
    ]);
  });

  it("treats no file as an empty one, and a file named like the placeholder as its own", () => {
    const none: RawFinding = { tool: "eslint", rule: "r", verdict: "fail", message: "m" };
    const done = completeFindings(
      [
        none,
        found({ rule: "r", file: "", message: "m" }),
        found({ rule: "r", file: "x", message: "m" }),
      ],
      noSource,
    );
    expect(done.map((item) => item.fingerprint)).toEqual([
      fp("r", null, "m", 1),
      fp("r", "", "m", 2),
      fp("r", "x", "m", 1),
    ]);
  });
});

describe("what a completed finding carries beyond the shape", () => {
  it("has required, ack and survivor only when the finding had them", () => {
    const plain = completeFindings([found()], noSource)[0];
    expect(Object.keys(plain ?? {}).sort()).toEqual([
      "file",
      "fingerprint",
      "law",
      "line",
      "message",
      "rule",
      "tool",
      "verdict",
    ]);
    const survivor = {
      file: "src/a.ts",
      function: "f",
      mutator: "m",
      original: "o",
      replacement: "r",
      occurrence: 1,
    };
    const full = completeFindings(
      [found({ required: false, survivor: { ...survivor }, ack: undefined })],
      noSource,
    )[0];
    expect(full).toMatchObject({ required: false, survivor });
    expect("ack" in (full ?? {})).toBe(false);
  });
});
