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
  rule: "coverage-hint",
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
    ["the report version", (r: GateReport) => ({ ...r, report_version: "2.1.0" })],
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
});
