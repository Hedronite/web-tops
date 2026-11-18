import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import schema from "../../schema/gate-report.schema.json" with { type: "json" };
import { REPORT_VERSION, TOOLS, validateReport } from "../config/report.ts";
import { at, edit, get } from "../config/test-support.ts";

/** G1a: one findings shape, in the schema and in the validator (WEB_TOPS.md section 6.6). */

const root = resolve(import.meta.dirname, "../..");

function fixture(name: string): unknown {
  const value: unknown = JSON.parse(readFileSync(resolve(root, "fixtures/report", name), "utf8"));
  return value;
}

function pointers(report: unknown): string[] {
  const result = validateReport(report);
  return result.ok ? [] : result.problems.map((problem) => problem.pointer);
}

function names(value: unknown): string[] {
  return typeof value === "object" && value !== null ? Object.keys(value) : [];
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `fail.json` holds one finding, on the tests layer at index 1. */
const FINDING = ["layers", "1", "findings", "0"];
const AT = "/layers/1/findings/0";

describe("G1a every finding has tool, rule, law, verdict, message, file, line and fingerprint", () => {
  it("the fixtures hold complete findings, and report_version is 2.0.0", () => {
    expect(REPORT_VERSION).toBe("2.0.0");
    const finding = at(fixture("fail.json"), FINDING);
    expect(names(finding).sort()).toEqual([
      "file",
      "fingerprint",
      "law",
      "line",
      "message",
      "rule",
      "tool",
      "verdict",
    ]);
    expect(pointers(fixture("fail.json"))).toEqual([]);
  });

  it.each(["tool", "rule", "law", "verdict", "message", "file", "line", "fingerprint"])(
    "a finding missing %s fails at its pointer",
    (key) => {
      expect(pointers(edit(fixture("fail.json"), [...FINDING, key]))).toEqual([`${AT}/${key}`]);
    },
  );

  it("a finding with a key of its own fails: a layer cannot ship its own shape", () => {
    expect(pointers(edit(fixture("fail.json"), [...FINDING, "severity"], "high"))).toEqual([
      `${AT}/severity`,
    ]);
  });

  it("the old shape, with no tool, law or fingerprint, fails", () => {
    const old = edit(edit(edit(fixture("fail.json"), [...FINDING, "tool"]), [...FINDING, "law"]), [
      ...FINDING,
      "fingerprint",
    ]);
    expect(pointers(old).sort()).toEqual([`${AT}/fingerprint`, `${AT}/law`, `${AT}/tool`].sort());
  });

  it("a report_version of the 1.x format fails", () => {
    expect(pointers(edit(fixture("fail.json"), ["report_version"], "1.0.0"))).toEqual([
      "/report_version",
    ]);
    expect(pointers(edit(fixture("fail.json"), ["report_version"], "2.1.0"))).toEqual([]);
  });
});

describe("G1a tool is a closed set", () => {
  it("the schema's tool enum is the typed TOOLS list", () => {
    expect(schema.$defs.tool.enum).toEqual([...TOOLS]);
    expect(TOOLS).toEqual([...TOOLS].sort());
  });

  it.each([...TOOLS])("accepts %s", (tool) => {
    expect(pointers(edit(fixture("fail.json"), [...FINDING, "tool"], tool))).toEqual([]);
  });

  it.each(["", "ESLint", "oxlint", "other"])("refuses %j", (tool) => {
    expect(pointers(edit(fixture("fail.json"), [...FINDING, "tool"], tool))).toEqual([
      `${AT}/tool`,
    ]);
  });

  it("section 6.6 lists every tool of the set", () => {
    const text = readFileSync(resolve(root, "WEB_TOPS.md"), "utf8");
    const section = text.slice(text.indexOf("\n### 6.6 "), text.indexOf("\n### 6.7 "));
    for (const tool of TOOLS) {
      expect(section, tool).toContain(`\`${tool}\``);
    }
  });
});

describe("G1a law, file, line and fingerprint", () => {
  it.each([null, "W-05", "W-46"])("accepts law %j", (law) => {
    expect(pointers(edit(fixture("fail.json"), [...FINDING, "law"], law))).toEqual([]);
  });

  it.each(["W-5", "w-05", "W-005", "05", ""])("refuses law %j", (law) => {
    expect(pointers(edit(fixture("fail.json"), [...FINDING, "law"], law))).toEqual([`${AT}/law`]);
  });

  it("file and line may be null together: a finding with no place", () => {
    const placeless = edit(
      edit(fixture("fail.json"), [...FINDING, "file"], null),
      [...FINDING, "line"],
      null,
    );
    expect(pointers(placeless)).toEqual([]);
  });

  it("a line with no file fails, and a line below 1 fails", () => {
    expect(pointers(edit(fixture("fail.json"), [...FINDING, "file"], null))).not.toEqual([]);
    expect(pointers(edit(fixture("fail.json"), [...FINDING, "line"], 0))).toEqual([`${AT}/line`]);
  });

  it.each([
    "fp1:abc",
    "fp2:0123456789abcdef",
    "0123456789abcdef",
    "fp1:0123456789ABCDEF",
    "fp1:0123456789abcdef0",
    "",
  ])("refuses fingerprint %j", (value) => {
    expect(pointers(edit(fixture("fail.json"), [...FINDING, "fingerprint"], value))).toEqual([
      `${AT}/fingerprint`,
    ]);
  });

  it("an acknowledged finding still carries its ack beside the complete shape", () => {
    const report = fixture("pass.json");
    const finding = at(report, ["layers", "6", "findings", "0"]);
    expect(get(finding, "ack")).toBeDefined();
    expect(get(finding, "fingerprint")).toMatch(/^fp1:/u);
    expect(pointers(report)).toEqual([]);
  });
});

describe("G1b metrics.findings is the count of the layer's own findings", () => {
  const report = fixture("shape/with-metrics.json");

  it("holds in the fixture, where the hygiene findings are the rows' source", () => {
    expect(pointers(report)).toEqual([]);
    const findings = list(at(report, ["layers", "0", "findings"]));
    expect(findings).toHaveLength(6);
  });

  it("a count that disagrees with the findings fails at the layer's metrics", () => {
    const wrong = edit(report, ["layers", "0", "metrics", "findings", "0", "count"], 9);
    expect(pointers(wrong)).toEqual(["/layers/0/metrics/findings"]);
  });

  it("a finding added to the layer without its count fails", () => {
    const findings = list(at(report, ["layers", "0", "findings"]));
    const extra = edit(report, ["layers", "0", "findings"], [...findings, findings[0]]);
    expect(pointers(extra)).toEqual(["/layers/0/metrics/findings"]);
  });

  it("a layer with findings and no findings metrics fails: the counts are not optional", () => {
    expect(pointers(edit(report, ["layers", "0", "metrics", "findings"]))).toEqual([
      "/layers/0/metrics/findings",
    ]);
  });
});
