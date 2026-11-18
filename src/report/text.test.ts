import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReport } from "../gate/testkit.ts";
import type { Finding, Report, ReportLayer } from "./types.ts";
import { formatText } from "./text.ts";

/** G1d, G1e: the printer speaks the eight verdicts, and a stopped run prints the laws mapping for what ran. */

function fixture(name: string): Report {
  return parseReport(
    readFileSync(resolve(import.meta.dirname, "../../fixtures/report", `${name}.json`), "utf8"),
  );
}

const STOPPED = "stopped: gate 2 failed";

/** The refuse fixture, with tests failed and gates 3 to 6 not run: the shape of a run stopped at gate 2. */
function stopped(): Report {
  const base = fixture("refuse");
  const layers = base.layers.map((layer): ReportLayer => {
    if (layer.id === "tests") {
      return { ...layer, verdict: "fail", findings: [] };
    }
    return ["coverage", "crap", "mutation", "build-output"].includes(layer.id)
      ? { ...layer, verdict: "not-run", reason: STOPPED }
      : layer;
  });
  return { ...base, layers };
}

describe("G1e formatText prints every verdict of section 3.3", () => {
  it.each(["pass", "fail", "refuse", "ack-missing", "skip", "not-run", "not-evaluated", "vacuous"])(
    "prints a layer that is %s, with its verdict in the verdict column",
    (verdict) => {
      const text = formatText(fixture(verdict));
      expect(text).toMatch(new RegExp(`tier 1  ${verdict}`, "u"));
    },
  );

  it("keeps the verdict and the reason apart on a long verdict", () => {
    const text = formatText(fixture("not-evaluated"));
    expect(text).toContain("tier 1  not-evaluated a law has no reader yet");
  });
});

describe("G1d a stopped run prints the laws mapping for what ran", () => {
  it("prints the laws findings in a block that names the layers they were read from", () => {
    const text = formatText(stopped());
    expect(text).toContain("laws mapping (from hygiene, tests):");
    expect(text).toContain(
      "      - [refuse] TS1294: enum declaration is forbidden (src/state.ts:4)",
    );
  });

  it("prints each law finding once, in the block and not again under the laws layer", () => {
    const text = formatText(stopped());
    expect(text.split("TS1294").length - 1).toBe(1);
  });

  it("prints no block when the laws layer has no findings", () => {
    expect(formatText(fixture("fail"))).not.toContain("laws mapping");
  });

  it("names none when no other layer ran", () => {
    const base = stopped();
    const layers = base.layers.map((layer): ReportLayer =>
      layer.id === "laws" ? layer : { ...layer, verdict: "not-run", reason: STOPPED },
    );
    expect(formatText({ ...base, layers })).toContain("laws mapping (from none):");
  });
});

/** A passing census finding of a kind, one for each file: the readers write one per hit (R76). */
function census(kind: string, count: number, verdict: Finding["verdict"] = "pass"): Finding[] {
  return Array.from({ length: count }, (_, index) => ({
    tool: "webtops",
    rule: `census/${kind}`,
    law: null,
    verdict,
    message: `${kind} hit number ${String(index)}`,
    file: `src/${kind}-${String(index)}.ts`,
    line: index + 1,
    fingerprint: "fp1:0000000000000000",
  }));
}

const COVERAGE_PASS: Finding = {
  tool: "webtops",
  rule: "coverage",
  law: null,
  verdict: "pass",
  message: "fixture: 99 % of 10 lines in 1 files, floor 85 %",
  file: null,
  line: null,
  fingerprint: "fp1:1111111111111111",
};

/** The pass fixture, with these findings on its coverage layer. */
function withCoverageFindings(findings: readonly Finding[]): Report {
  const base = fixture("pass");
  const layers = base.layers.map((layer): ReportLayer =>
    layer.id === "coverage" ? { ...layer, findings } : layer,
  );
  return { ...base, layers };
}

describe("R76 passing census findings fold into one count for each kind in the text report", () => {
  it("prints a count for each kind, and none of the hits", () => {
    const text = formatText(
      withCoverageFindings([...census("eslint-ignores", 153), ...census("ts-ignore", 2)]),
    );
    expect(text).toContain(
      "      - [pass] census/eslint-ignores: 153 found, listed in the JSON report",
    );
    expect(text).toContain("      - [pass] census/ts-ignore: 2 found, listed in the JSON report");
    expect(text).not.toContain("hit number");
    expect(text).not.toContain("src/eslint-ignores-0.ts");
  });

  it("folds one hit too, and says nothing about a kind with no hit", () => {
    const text = formatText(withCoverageFindings(census("tsconfig-exclude", 1)));
    expect(text).toContain("census/tsconfig-exclude: 1 found");
    expect(text).not.toContain("census/ts-ignore");
  });

  it("prints the other findings as before, and the counts after them, kinds in the order met", () => {
    const text = formatText(
      withCoverageFindings([
        ...census("ts-ignore", 1),
        COVERAGE_PASS,
        ...census("eslint-ignores", 2),
        ...census("ts-ignore", 1),
      ]),
    );
    const lines = text.split("\n").filter((line) => line.startsWith("      - "));
    const mine = lines.filter((line) => line.includes("coverage") || line.includes("census/"));
    expect(mine).toEqual([
      "      - [pass] coverage: fixture: 99 % of 10 lines in 1 files, floor 85 %",
      "      - [pass] census/ts-ignore: 2 found, listed in the JSON report",
      "      - [pass] census/eslint-ignores: 2 found, listed in the JSON report",
    ]);
  });

  it("does not fold a census finding that is not a pass: it is a problem, printed as it is", () => {
    const text = formatText(
      withCoverageFindings([...census("ts-ignore", 2), ...census("ts-ignore", 1, "fail")]),
    );
    expect(text).toContain("census/ts-ignore: 2 found, listed in the JSON report");
    expect(text).toContain(
      "      - [fail] census/ts-ignore: ts-ignore hit number 0 (src/ts-ignore-0.ts:1)",
    );
  });

  it("folds only a rule under census/, not another that is named like it", () => {
    const like: Finding = { ...COVERAGE_PASS, rule: "census-like", message: "kept" };
    const text = formatText(withCoverageFindings([like, ...census("ts-ignore", 1)]));
    expect(text).toContain("      - [pass] census-like: kept");
  });

  it("folds before the cap: a hundred and fifty hits do not hide the other findings or print a 'more' line", () => {
    const text = formatText(
      withCoverageFindings([...census("eslint-ignores", 150), COVERAGE_PASS]),
    );
    expect(text).toContain("census/eslint-ignores: 150 found");
    expect(text).toContain("      - [pass] coverage:");
    expect(text).not.toContain("more findings, not listed");
  });

  it("keeps the cap for the findings that are not folded", () => {
    const many = Array.from({ length: 103 }, (_, index) => ({
      ...COVERAGE_PASS,
      message: `n ${String(index)}`,
    }));
    const text = formatText(withCoverageFindings([...many, ...census("ts-ignore", 4)]));
    expect(text).toContain("      - and 3 more findings, not listed");
    expect(text).toContain("census/ts-ignore: 4 found");
  });

  it("leaves the report as it was: the JSON keeps every finding", () => {
    const report = withCoverageFindings(census("eslint-ignores", 5));
    formatText(report);
    const kept = report.layers.find((layer) => layer.id === "coverage")?.findings ?? [];
    expect(kept).toHaveLength(5);
  });
});
