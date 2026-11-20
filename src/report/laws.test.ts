import { describe, expect, it } from "vitest";
import type { Finding } from "../config/report.ts";
import { summarizeLaws } from "./laws.ts";

const finding = (
  rule: string,
  verdict: Finding["verdict"],
  extra: Partial<Finding> = {},
): Finding => ({
  tool: "webtops",
  rule,
  law: rule.startsWith("law/") ? rule.slice(4) : null,
  verdict,
  message: "m",
  file: null,
  line: null,
  fingerprint: "fp1:0000000000000000",
  required: true,
  ...extra,
});

/** A law's finding with no `required` field at all. */
function unrequired(rule: string, verdict: Finding["verdict"]): Finding {
  const { fingerprint, message, file, line, tool, law } = finding(rule, verdict);
  return { tool, rule, law, verdict, message, file, line, fingerprint };
}

describe("G4d N of M laws judged, read back from the laws layer's findings", () => {
  it("counts the required laws, those a reader judged, and the refused and not-evaluated among them", () => {
    const findings = [
      finding("law/W-01", "pass"),
      finding("law/W-02", "refuse"),
      finding("law/W-04", "ack-missing"),
      finding("law/W-16", "not-evaluated"),
      finding("law/W-17", "fail"),
    ];
    expect(summarizeLaws(findings, "ts-library")).toEqual({
      class: "ts-library",
      of: 5,
      judged: 3,
      refused: 1,
      not_evaluated: 1,
    });
  });

  it("a law that is not required is not counted, and nor is a finding that is not a law's own", () => {
    const findings = [
      finding("law/W-01", "pass"),
      finding("law/W-03", "not-evaluated", { required: false }),
      unrequired("law/W-05", "pass"),
      finding("@typescript-eslint/no-explicit-any", "refuse", {
        law: "W-01",
        file: "eslint.config.js",
        line: 3,
      }),
      finding("law/W-X", "pass"),
    ];
    expect(summarizeLaws(findings, "node-service")).toEqual({
      class: "node-service",
      of: 1,
      judged: 1,
      refused: 0,
      not_evaluated: 0,
    });
  });

  it("no law findings is zero of zero", () => {
    expect(summarizeLaws([], "ts-library")).toMatchObject({ of: 0, judged: 0 });
  });
});
