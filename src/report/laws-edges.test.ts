import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTED_LAYERS, validateReport, type Finding } from "../config/report.ts";
import { edit, get } from "../config/test-support.ts";
import { summarizeLaws } from "./laws.ts";
import { formatText } from "./text.ts";
import type { Report } from "./types.ts";

/** The laws block and the text report, pinned at their edges. */

const root = resolve(import.meta.dirname, "../..");

function fixture(name: string): unknown {
  const value: unknown = JSON.parse(readFileSync(resolve(root, "fixtures/report", name), "utf8"));
  return value;
}

function report(name: string, ...changes: [string[], unknown][]): Report {
  const edited = changes.reduce((value, [path, to]) => edit(value, path, to), fixture(name));
  const result = validateReport(edited);
  if (!result.ok) {
    throw new Error(`not valid: ${JSON.stringify(result.problems)}`);
  }
  return result.value;
}

const lawFinding = (rule: string): Finding => ({
  tool: "webtops",
  rule,
  law: null,
  verdict: "pass",
  message: "m",
  file: null,
  line: null,
  fingerprint: "fp1:0000000000000000",
  required: true,
});

describe("the layers whose findings are counted per rule per file", () => {
  it("are gate 1 and the laws layer", () => {
    expect([...COUNTED_LAYERS].sort()).toEqual(["hygiene", "laws"]);
  });
});

describe("a law's own finding is exactly law/W-NN", () => {
  it("is not one when the rule has a prefix or a suffix", () => {
    const counted = summarizeLaws(
      [
        lawFinding("law/W-01"),
        lawFinding("x-law/W-02"),
        lawFinding("law/W-03x"),
        lawFinding("law/W-"),
      ],
      "ts-library",
    );
    expect(counted).toMatchObject({ of: 1, judged: 1 });
  });
});

describe("a report that does not hold together says what is wrong", () => {
  it("names the built-in layer that is missing", () => {
    const layers = get(fixture("pass.json"), "layers");
    if (!Array.isArray(layers)) {
      throw new Error("no layers");
    }
    const without = layers.filter((layer) => get(layer, "id") !== "tests");
    const result = validateReport(edit(fixture("pass.json"), ["layers"], without));
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.map((problem) => problem.message)).toContain(
      'layer "tests" is missing',
    );
  });

  it("gives no layer name to a problem that is not a missing layer", () => {
    const result = validateReport(edit(fixture("pass.json"), ["enforce"], "bogus"));
    const messages = result.ok ? [] : result.problems.map((problem) => problem.message);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.filter((message) => message.includes("is missing"))).toEqual([]);
  });

  it("says the laws counts are not those of the laws layer's findings, at /laws", () => {
    const result = validateReport(edit(fixture("shape/laws.json"), ["laws", "of"], 0));
    expect(result.ok ? [] : result.problems).toEqual([
      { pointer: "/laws", message: "the laws counts are not those of the laws layer's findings" },
    ]);
  });
});

describe("the text report", () => {
  it("prints the laws mapping, the count and the end of a run that failed", () => {
    expect(formatText(report("shape/laws.json"))).toBe(
      [
        "webtops gate  ts-library  hard  protocol 0.3.0",
        "",
        "  1      hygiene        tier 1  pass",
        "  2      tests          tier 1  pass",
        "  3      coverage       tier 1  pass",
        "  4      crap           tier 1  pass",
        "  5      mutation       tier 1  pass",
        "  6      build-output   tier 1  pass",
        "  laws   laws           tier 1  refuse",
        "",
        "  laws mapping (from hygiene, tests, coverage, crap, mutation, build-output):",
        "      - [pass] law/W-01: W-01 pass",
        "      - [refuse] law/W-02: W-02 refuse",
        "      - [not-evaluated] law/W-16: W-16 not-evaluated",
        "      - [not-evaluated] law/W-03: W-03 not-evaluated",
        "",
        "laws: 2 of 3 judged (ts-library)",
        "layers: 7 in range, 7 ran, 1 failed, 0 not-evaluated",
        "gate failed (exit 1)",
        "",
      ].join("\n"),
    );
  });

  it("has no laws mapping or count when the laws layer found nothing, and prints a reason after the verdict", () => {
    expect(formatText(report("not-run.json"))).toBe(
      [
        "webtops gate  ts-library  hard  protocol 0.3.0",
        "",
        "  1      hygiene        tier 1  pass",
        "  2      tests          tier 1  pass",
        "  3      coverage       tier 1  pass",
        "  4      crap           tier 1  pass",
        "  5      mutation       tier 1  not-run       mutation lands in M2",
        "  6      build-output   tier 1  pass",
        "  laws   laws           tier 1  pass",
        "",
        "layers: 7 in range, 6 ran, 1 failed, 0 not-evaluated",
        "gate failed (exit 1)",
        "",
      ].join("\n"),
    );
  });

  it("says when a run is not enforced", () => {
    const text = formatText(report("pass.json", [["enforce"], "advisory"], [["enforced"], false]));
    expect(text).toContain("not enforced (advisory)\ngate passed\n");
  });

  it("takes a trailing required-by out of the reason only when it ends the reason", () => {
    const stopped = report("pass.json", [
      ["layers", "1", "reason"],
      "a test failed (required by coverage)",
    ]);
    expect(formatText(stopped)).toContain(
      "  2      tests (required by coverage) tier 1  pass          a test failed",
    );
    const inside = report("pass.json", [
      ["layers", "1", "reason"],
      "see required by the notes here",
    ]);
    expect(formatText(inside)).toContain(
      "  2      tests          tier 1  pass          see required by the notes here",
    );
  });
});
