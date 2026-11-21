import { describe, expect, it } from "vitest";
import type { Finding } from "../config/report.ts";
import type { Report } from "../report/types.ts";
import { lawsOf } from "./runner.ts";

/** The report's laws block, counted from the laws layer's findings (G4d): the function that does it, called directly. */

type Layer = Report["layers"][number];

const law = (id: string, verdict: Finding["verdict"], required = true): Finding => ({
  tool: "webtops",
  rule: `law/${id}`,
  law: id,
  verdict,
  message: `${id} ${verdict}`,
  file: null,
  line: null,
  fingerprint: "fp1:0000000000000000",
  required,
});

function layer(id: string, verdict: Layer["verdict"], findings: readonly Finding[]): Layer {
  return {
    id,
    gate: id === "laws" ? "laws" : 1,
    tier: 1,
    required: true,
    verdict,
    findings,
    metrics: {},
    artifacts: [],
    duration_ms: 0,
  };
}

const FINDINGS = [
  law("W-01", "pass"),
  law("W-02", "refuse"),
  law("W-16", "not-evaluated"),
  law("W-03", "not-evaluated", false),
];

describe("G4d the laws block of the report", () => {
  it("counts the required laws of the laws layer, those judged, refused and not evaluated, for the class", () => {
    expect(lawsOf([layer("laws", "refuse", FINDINGS)], "node-service")).toEqual({
      laws: { class: "node-service", of: 3, judged: 2, refused: 1, not_evaluated: 1 },
    });
  });

  it("is the laws layer's findings alone: another layer's law findings are not counted", () => {
    const others = layer("hygiene", "pass", [law("W-09", "pass")]);
    expect(lawsOf([others, layer("laws", "pass", FINDINGS)], "ts-library")).toMatchObject({
      laws: { of: 3, judged: 2 },
    });
  });

  it.each(["skip", "not-run"] as const)("says nothing when the laws layer was %s", (verdict) => {
    expect(lawsOf([layer("laws", verdict, FINDINGS)], "ts-library")).toEqual({});
  });

  it("says nothing when there is no laws layer, and counts a layer that ran with no finding as zero of zero", () => {
    expect(lawsOf([layer("hygiene", "pass", FINDINGS)], "ts-library")).toEqual({});
    expect(lawsOf([layer("laws", "pass", [])], "ts-library")).toEqual({
      laws: { class: "ts-library", of: 0, judged: 0, refused: 0, not_evaluated: 0 },
    });
  });

  it.each(["pass", "fail", "refuse", "not-evaluated", "vacuous", "ack-missing"] as const)(
    "counts a laws layer that ran with verdict %s",
    (verdict) => {
      expect(lawsOf([layer("laws", verdict, FINDINGS)], "ts-library")).toHaveProperty("laws");
    },
  );
});
