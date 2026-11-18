import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateReport,
  type Finding,
  type GateReport,
  type LayerReport,
} from "../config/report.ts";
import { bootstrapProblem, scopeProblem } from "./bootstrap.ts";

const source: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../fixtures/report/shape/with-metrics.json"), "utf8"),
);

function report(): GateReport {
  const result = validateReport(source);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.value;
}

const FP = "fp1:0123456789abcdef";

const row = (
  rule: string,
  verdict: Finding["verdict"] = "fail",
  over: Partial<Finding> = {},
): Finding => ({
  tool: "webtops",
  rule,
  law: null,
  verdict,
  message: rule,
  file: null,
  line: null,
  fingerprint: FP,
  ...over,
});

/** The report with one layer replaced. */
function with_(id: string, patch: Partial<LayerReport>, top: Partial<GateReport> = {}): GateReport {
  const base = report();
  return {
    ...base,
    ...top,
    layers: base.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
  };
}

const counted = row("no-console", "fail", { tool: "eslint", file: "src/a.ts", line: 1 });

describe("G9-2: with no baseline yet, a report is a first baseline if its only failures are what a baseline holds", () => {
  it("accepts a report that passed, and one whose hygiene failures are counted findings with a file", () => {
    expect(
      bootstrapProblem(with_("hygiene", { verdict: "pass", findings: [] }, { passed: true })),
    ).toBeUndefined();
    expect(bootstrapProblem(report())).toBeUndefined();
  });

  it.each([
    ["coverage under the floor", "coverage", row("coverage-below-floor")],
    [
      "a function over the CRAP cap",
      "crap",
      row("crap-over-cap", "fail", { file: "src/a.ts", line: 2 }),
    ],
    [
      "an unexplained survivor",
      "mutation",
      row("survived", "fail", { tool: "stryker", file: "src/a.ts", line: 3 }),
    ],
    [
      "a mutant no test covers",
      "mutation",
      row("no-coverage", "fail", { tool: "stryker", file: "src/a.ts", line: 3 }),
    ],
    ["a counted law finding", "laws", counted],
  ])("accepts %s", (_what, id, finding) => {
    expect(bootstrapProblem(with_(id, { verdict: "fail", findings: [finding] }))).toBeUndefined();
  });

  it.each([
    [
      "a layer that crashed",
      "tests",
      { verdict: "fail" as const, findings: [row("vitest-failed", "fail", { tool: "vitest" })] },
    ],
    [
      "failing tests",
      "tests",
      {
        verdict: "fail" as const,
        findings: [row("test-failed", "fail", { tool: "vitest", file: "src/a.test.ts", line: 4 })],
      },
    ],
    [
      "a layer that did not run",
      "coverage",
      { verdict: "not-run" as const, reason: "stopped", findings: [] },
    ],
    [
      "a layer not evaluated",
      "crap",
      { verdict: "not-evaluated" as const, reason: "x", findings: [] },
    ],
    [
      "a tool that could not run",
      "hygiene",
      { verdict: "fail" as const, findings: [row("tool-missing", "fail")] },
    ],
    [
      "an audit finding, which has no file for a baseline to count",
      "hygiene",
      { verdict: "fail" as const, findings: [row("audit-high", "fail", { tool: "audit" })] },
    ],
    [
      "a stryker crash",
      "mutation",
      { verdict: "fail" as const, findings: [row("stryker-failed", "fail", { tool: "stryker" })] },
    ],
    [
      "a failed layer with no finding that says why",
      "crap",
      { verdict: "fail" as const, findings: [] },
    ],
  ])("refuses %s", (_what, id, patch) => {
    expect(bootstrapProblem(with_(id, patch))).toMatch(new RegExp(`^${id}`));
  });

  it("refuses a report with problems, such as a stopped run", () => {
    expect(
      bootstrapProblem(
        with_(
          "tests",
          {},
          { problems: [{ path: "/counts/ran", message: "ran 3 of 5 layers in range" }] },
        ),
      ),
    ).toMatch(/ran 3 of 5/);
  });
});

describe("G9-3: the baseline holds every function, so its CRAP must come from an all-functions run", () => {
  it("accepts a run that judged every function, or that had no CRAP layer to judge", () => {
    expect(scopeProblem({ ...report(), crap_scope: "all" })).toBeUndefined();
    expect(
      scopeProblem(with_("crap", { verdict: "skip", reason: "off", findings: [] })),
    ).toBeUndefined();
  });

  it("refuses a run that judged only the diff's functions, or does not say, naming --all", () => {
    for (const crap_scope of ["diff", undefined] as const) {
      const text = scopeProblem({
        ...report(),
        ...(crap_scope === undefined ? {} : { crap_scope }),
      });
      expect(text).toContain("--all");
    }
  });
});
