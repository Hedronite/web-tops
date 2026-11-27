import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { validateReport, type GateReport, type LayerReport } from "../config/report.ts";
import { get } from "../config/test-support.ts";
import { projectBaseline } from "./project.ts";

const shape = join(import.meta.dirname, "../../fixtures/report/shape");
const source: unknown = JSON.parse(readFileSync(join(shape, "with-metrics.json"), "utf8"));
const p3: unknown = JSON.parse(readFileSync(join(shape, "baseline.json"), "utf8"));

function report(): GateReport {
  const result = validateReport(source);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.value;
}

function withLayer(base: GateReport, id: string, patch: Partial<LayerReport>): GateReport {
  return {
    ...base,
    layers: base.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
  };
}

function layer(base: GateReport, id: string): LayerReport {
  const found = base.layers.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

const HINT = (
  kind: string,
  line: number,
  fingerprint: string,
): LayerReport["findings"][number] => ({
  tool: "webtops",
  rule: `coverage-hint/${kind.split(" ")[0] ?? ""}`,
  law: null,
  verdict: "pass",
  message: `a ${kind} hint takes lines out of the coverage profile`,
  file: "src/guard.ts",
  line,
  fingerprint,
});

describe("G9: the baseline is projected from the report and from nothing else", () => {
  it("holds, for the P3 report example, the P3 baseline example and the fingerprints of its counted findings", () => {
    const projected = projectBaseline(report());
    for (const key of ["report_version", "subject", "crap", "coverage", "findings", "pages"]) {
      expect(get(projected, key), key).toEqual(get(p3, key));
    }
    const counted = layer(report(), "hygiene")
      .findings.filter((finding) => finding.file !== null)
      .map((finding) => finding.fingerprint);
    expect(projected.fingerprints).toEqual([...new Set(counted)].sort());
    expect(projected.census).toEqual({});
  });

  it("counts a coverage hint by kind, with the fingerprint of each directive (R60)", () => {
    const base = report();
    const hints = [
      HINT("v8 ignore", 2, "fp1:1111111111111111"),
      HINT("v8 ignore", 9, "fp1:2222222222222222"),
      HINT("istanbul ignore", 4, "fp1:3333333333333333"),
      HINT("c8 ignore", 6, "fp1:4444444444444444"),
    ];
    const projected = projectBaseline(withLayer(base, "coverage", { findings: hints }));
    expect(projected.census).toEqual({
      "v8-ignore": { count: 2, fingerprints: ["fp1:1111111111111111", "fp1:2222222222222222"] },
      "istanbul-ignore": { count: 1, fingerprints: ["fp1:3333333333333333"] },
      "c8-ignore": { count: 1, fingerprints: ["fp1:4444444444444444"] },
    });
  });

  it("counts only findings whose verdict ends the run, never a pass or an explained row (R69)", () => {
    const base = report();
    const explained = {
      ...HINT("v8 ignore", 1, "fp1:7777777777777777"),
      tool: "webtops" as const,
      rule: "survivor-explained",
      file: "src/wire.ts",
      line: 3,
    };
    const passRow = {
      ...explained,
      rule: "no-console",
      tool: "eslint" as const,
      fingerprint: "fp1:8888888888888888",
    };
    const skipRow = { ...passRow, verdict: "skip" as const, fingerprint: "fp1:6666666666666666" };
    const failRow = { ...passRow, verdict: "fail" as const, fingerprint: "fp1:5555555555555555" };
    const extra = (rows: LayerReport["findings"]): GateReport =>
      withLayer(withLayer(base, "mutation", { findings: [explained] }), "hygiene", {
        findings: [...layer(base, "hygiene").findings, ...rows],
      });
    const plain = projectBaseline(base);
    expect(projectBaseline(extra([passRow, skipRow]))).toEqual(plain);
    const counted = projectBaseline(extra([failRow]));
    expect(counted.fingerprints).toContain("fp1:5555555555555555");
    expect(counted.findings["no-console"]?.["src/wire.ts"]).toBe(
      (plain.findings["no-console"]?.["src/wire.ts"] ?? 0) + 1,
    );
  });

  it("is unchanged by anything that is not a source of the baseline", () => {
    const base = report();
    const noisy: GateReport = {
      ...base,
      run: { ...base.run, sha: "f".repeat(40), seed: 1, tools: {} },
      protocol: "0.3.7",
      counts: { ...base.counts, ran: 1 },
      max_tier: 0,
      layers: [...base.layers]
        .reverse()
        .map((entry) => ({ ...entry, reason: "x", duration_ms: 5 })),
    };
    expect(projectBaseline(noisy)).toEqual(projectBaseline(base));
  });

  it.each([
    [
      "a CRAP row",
      (r: GateReport) =>
        withLayer(r, "crap", {
          metrics: {
            crap: [{ file: "src/x.ts", name: "g", line: 1, complexity: 1, coverage: 1, crap: 1 }],
          },
        }),
    ],
    [
      "a coverage row",
      (r: GateReport) =>
        withLayer(r, "coverage", {
          metrics: { coverage: [{ file: "src/x.ts", lines_found: 4, lines_hit: 1 }] },
        }),
    ],
    [
      "a page",
      (r: GateReport) =>
        withLayer(r, "build-output", { metrics: { pages: [{ route: "/new", bytes: 5 }] } }),
    ],
    [
      "a counted finding",
      (r: GateReport) =>
        withLayer(r, "hygiene", {
          findings: [
            ...layer(r, "hygiene").findings,
            {
              ...HINT("v8 ignore", 1, "fp1:9999999999999999"),
              rule: "no-console",
              tool: "eslint",
              verdict: "fail",
            },
          ],
        }),
    ],
    ["the subject", (r: GateReport) => ({ ...r, subject: { package: "other", root: "." } })],
    ["the report version", (r: GateReport) => ({ ...r, report_version: "9.9.9" })],
  ])("changes with %s", (_what, change) => {
    expect(projectBaseline(change(report()))).not.toEqual(projectBaseline(report()));
  });

  it("is the same whatever order the findings and metric rows come in (property)", () => {
    const base = report();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (seed) => {
        const rotate = <T>(items: readonly T[]): T[] => {
          const by = items.length === 0 ? 0 : seed % items.length;
          return [...items.slice(by), ...items.slice(0, by)];
        };
        const shuffled: GateReport = {
          ...base,
          layers: base.layers.map((entry) => ({
            ...entry,
            findings: rotate(entry.findings),
            metrics: { ...entry.metrics, findings: rotate(entry.metrics.findings ?? []) },
          })),
        };
        expect(projectBaseline(shuffled)).toEqual(projectBaseline(base));
      }),
    );
  });

  it("counts and fingerprints non-failing axe findings emitted on build-output", () => {
    const axeRow = {
      tool: "webtops" as const,
      rule: "axe:meta-viewport",
      law: "W-21",
      verdict: "pass" as const,
      message: 'axe meta-viewport at meta[name="viewport"]',
      file: "dist/index.html",
      line: null,
      fingerprint: "fp1:1234567890abcdef",
    };
    const projected = projectBaseline(withLayer(report(), "build-output", { findings: [axeRow] }));
    expect(projected.findings["axe:meta-viewport"]).toEqual({ "dist/index.html": 1 });
    expect(projected.fingerprints).toContain("fp1:1234567890abcdef");
  });

  it("excludes non-counted layers, null-file findings, non-ending optional laws, and failing/non-axe build-output rows", () => {
    const base = report();
    const testsFail = {
      ...HINT("v8 ignore", 1, "fp1:aaaa000000000001"),
      tool: "vitest" as const,
      rule: "test-fail",
      verdict: "fail" as const,
      file: "src/t.ts",
    };
    const nullFile = { ...testsFail, tool: "eslint" as const, rule: "no-any", file: null };
    const optLawNotEval = {
      ...testsFail,
      tool: "webtops" as const,
      rule: "law/W-20",
      verdict: "not-evaluated" as const,
      required: false,
    };
    const reqLawNotEval = {
      ...testsFail,
      tool: "webtops" as const,
      rule: "law/W-01",
      verdict: "not-evaluated" as const,
      fingerprint: "fp1:cccccccccccccccc",
    };
    const axeFail = {
      ...testsFail,
      tool: "webtops" as const,
      rule: "axe:image-alt",
      verdict: "fail" as const,
      file: "dist/a.html",
    };
    const linksPass = { ...axeFail, rule: "links", verdict: "pass" as const };
    const axeSpaPass = {
      ...axeFail,
      rule: "axe:region",
      verdict: "pass" as const,
      file: null,
    };
    const unsortedB = HINT("v8 ignore", 2, "fp1:bbbbbbbbbbbbbbbb");
    const unsortedA = HINT("v8 ignore", 1, "fp1:aaaaaaaaaaaaaaaa");
    let custom = withLayer(base, "coverage", { metrics: {} });
    custom = withLayer(custom, "tests", { findings: [testsFail] });
    custom = withLayer(custom, "hygiene", { findings: [nullFile, unsortedB, unsortedA] });
    custom = withLayer(custom, "laws", { findings: [optLawNotEval, reqLawNotEval] });
    custom = withLayer(custom, "build-output", { findings: [axeFail, linksPass, axeSpaPass] });

    const projected = projectBaseline(custom);
    expect(projected.coverage).toEqual({});
    expect(projected.findings["test-fail"]).toBeUndefined();
    expect(projected.findings["no-any"]).toBeUndefined();
    expect(projected.findings["law/W-20"]).toBeUndefined();
    expect(projected.findings["law/W-01"]).toEqual({ "src/t.ts": 1 });
    expect(projected.findings["axe:image-alt"]).toBeUndefined();
    expect(projected.findings["links"]).toBeUndefined();
    expect(projected.findings["axe:region"]).toEqual({ "(built-page)": 1 });
    expect(projected.census["v8-ignore"]?.fingerprints).toEqual([
      "fp1:aaaaaaaaaaaaaaaa",
      "fp1:bbbbbbbbbbbbbbbb",
    ]);
  });
});
