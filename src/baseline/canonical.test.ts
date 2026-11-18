import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical.ts";
import { validateBaseline } from "./schema.ts";
import type { Baseline } from "./types.ts";

const GOOD: Baseline = {
  report_version: "2.0.0",
  subject: { package: "p", root: "." },
  crap: { "src/a.ts::f": { complexity: 3, coverage: 0.5, crap: 4.5 } },
  coverage: { p: { lines_found: 10, lines_hit: 8 } },
  findings: { "no-console": { "src/a.ts": 2 } },
  fingerprints: ["fp1:0123456789abcdef"],
  census: { "v8-ignore": { count: 1, fingerprints: ["fp1:0123456789abcdef"] } },
  pages: { "/": 1000 },
};

describe("G9a: the baseline is written in one canonical form", () => {
  it("sorts every object's keys, indents by two, keeps array order, and ends with a newline", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: 2 } })).toBe(
      '{\n  "a": {\n    "c": 2,\n    "d": [\n      3,\n      1\n    ]\n  },\n  "b": 1\n}\n',
    );
  });

  it("is idempotent: parsing it and writing it again gives the same text", () => {
    const text = canonicalJson(GOOD);
    expect(canonicalJson(JSON.parse(text))).toBe(text);
  });
});

describe("G9a: baseline.schema.json refuses a file that is not what webtops baseline writes", () => {
  const edit = (patch: Record<string, unknown>): unknown => ({ ...GOOD, ...patch });
  const pointers = (value: unknown): string[] => {
    const result = validateBaseline(value);
    return result.ok ? [] : result.problems.map((problem) => problem.pointer);
  };

  it("accepts the good example, and an empty one", () => {
    expect(validateBaseline(GOOD).ok).toBe(true);
    expect(
      validateBaseline({
        ...GOOD,
        crap: {},
        coverage: {},
        findings: {},
        fingerprints: [],
        census: {},
        pages: {},
      }).ok,
    ).toBe(true);
  });

  it.each([
    ["a stray key", edit({ extra: 1 }), "/extra"],
    ["a negative finding count", edit({ findings: { r: { "a.ts": -1 } } }), "/findings/r/a.ts"],
    ["a fractional finding count", edit({ findings: { r: { "a.ts": 1.5 } } }), "/findings/r/a.ts"],
    [
      "coverage hit above found",
      edit({ coverage: { p: { lines_found: 1, lines_hit: 2 } } }),
      "/coverage/p",
    ],
    [
      "a CRAP row without complexity",
      edit({ crap: { "a.ts::f": { coverage: 1, crap: 1 } } }),
      "/crap/a.ts::f/complexity",
    ],
    [
      "a CRAP coverage above 1",
      edit({ crap: { "a.ts::f": { complexity: 1, coverage: 2, crap: 1 } } }),
      "/crap/a.ts::f/coverage",
    ],
    [
      "a fingerprint of the wrong form",
      edit({ fingerprints: ["fp2:0123456789abcdef"] }),
      "/fingerprints/0",
    ],
    [
      "a census entry whose count is not its fingerprints",
      edit({ census: { "v8-ignore": { count: 2, fingerprints: ["fp1:0123456789abcdef"] } } }),
      "/census/v8-ignore",
    ],
    ["a report version that is not a version", edit({ report_version: "two" }), "/report_version"],
    ["a missing subject", edit({ subject: undefined }), "/subject"],
    ["a negative page size", edit({ pages: { "/": -5 } }), "/pages/~1"],
    ["a document that is not an object", [], ""],
  ])("refuses %s, at its pointer", (_what, value, pointer) => {
    expect(pointers(value)).toContain(pointer);
  });
});
