import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import core from "../../schema/core.schema.json" with { type: "json" };
import reportSchema from "../../schema/gate-report.schema.json" with { type: "json" };
import { ajv } from "../config/ajv.ts";
import { PROTOCOL_MINOR } from "../config/protocol.ts";
import { FAILURE, VERDICTS, endsRun, validateReport, type Verdict } from "../config/report.ts";
import { edit } from "../config/test-support.ts";

/** G1a, G1b, G1c: one verdict vocabulary, in `schema/core.schema.json`, and one fixture report per verdict. */

const root = resolve(import.meta.dirname, "../..");
const FIXTURES = resolve(root, "fixtures/report");

function fixture(name: string): unknown {
  const value: unknown = JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), "utf8"));
  return value;
}

function pointers(report: unknown): string[] {
  const result = validateReport(report);
  return result.ok ? [] : result.problems.map((problem) => problem.pointer);
}

const SPEC_VERDICTS = [
  "pass",
  "fail",
  "refuse",
  "ack-missing",
  "skip",
  "not-run",
  "not-evaluated",
  "vacuous",
];

describe("G1a core.schema.json holds the verdicts, the modes and the failure table", () => {
  it("lists the eight verdicts of section 3.3, in that order", () => {
    expect(core.$defs.verdict.enum).toEqual(SPEC_VERDICTS);
  });

  it("references no other schema", () => {
    expect(JSON.stringify(core)).not.toContain('"$ref"');
  });

  it("gives its version in the id, the same minor as the protocol", () => {
    expect(core.$id).toBe(
      `https://hedronite.com/schemas/web-tops/${PROTOCOL_MINOR}/core.schema.json`,
    );
    expect(reportSchema.$id).toBe(core.$id.replace("core.schema.json", "gate-report.schema.json"));
  });

  it("the typed VERDICTS tuple equals the schema's enum", () => {
    expect([...VERDICTS]).toEqual(core.$defs.verdict.enum);
  });

  it("the typed failure table equals the schema's, and each row has the declared shape", () => {
    expect(FAILURE).toEqual(core.$defs.failure.const);
    const shape = ajv.getSchema(`${core.$id}#/$defs/failure_entry`);
    expect(shape).toBeDefined();
    for (const row of Object.values(core.$defs.failure.const)) {
      expect(shape?.(row)).toBe(true);
    }
    expect(Object.keys(core.$defs.failure.const)).toEqual(SPEC_VERDICTS);
  });

  it("lists the three enforcement modes, and only advisory is not enforced", () => {
    expect(core.$defs.enforce.enum).toEqual(["hard", "ratchet", "advisory"]);
    expect(core.$defs.modes.const).toEqual({
      hard: { enforced: true },
      ratchet: { enforced: true },
      advisory: { enforced: false },
    });
    expect(Object.keys(core.$defs.modes.const)).toEqual(core.$defs.enforce.enum);
  });

  it("the report schema takes its verdicts and its modes from the core, with no copy of the list", () => {
    const ref = { $ref: "core.schema.json#/$defs/verdict" };
    expect(reportSchema.$defs.layer.properties.verdict).toEqual(ref);
    expect(reportSchema.$defs.finding.properties.verdict).toEqual(ref);
    expect(reportSchema.properties.enforce).toEqual({ $ref: "core.schema.json#/$defs/enforce" });
    expect(JSON.stringify(reportSchema)).not.toContain('"ack-missing"');
  });
});

describe("G1a the 0.2.1 spellings fail", () => {
  const LAYER = ["layers", "1", "verdict"];
  const FINDING = ["layers", "1", "findings", "0", "verdict"];

  it.each(["Refuse", "Ack", "Failed", "Vacuous"])(
    "a layer verdict %s fails at its pointer",
    (old) => {
      expect(pointers(edit(fixture("fail"), LAYER, old))).toEqual(["/layers/1/verdict"]);
    },
  );

  it.each(["Refuse", "Ack", "Failed", "Vacuous"])(
    "a finding verdict %s fails at its pointer",
    (old) => {
      expect(pointers(edit(fixture("fail"), FINDING, old))).toEqual([
        "/layers/1/findings/0/verdict",
      ]);
    },
  );

  it("an acknowledgement belongs to a pass: an ack on any other verdict fails", () => {
    const acknowledged = {
      source: "comment",
      reason: "legacy parser, removal tracked",
    };
    const withAck = edit(
      fixture("ack-missing"),
      ["layers", "6", "findings", "0", "ack"],
      acknowledged,
    );
    expect(pointers(withAck)).toEqual(["/layers/6/findings/0/verdict"]);
  });
});

describe("G1c one fixture report per verdict", () => {
  it("has exactly one file per verdict of the enum", () => {
    const files = readdirSync(FIXTURES)
      .filter((name) => name.endsWith(".json"))
      .sort();
    expect(files).toEqual(SPEC_VERDICTS.map((name) => `${name}.json`).sort());
  });

  it.each(VERDICTS)("%s.json is a valid report that carries its verdict", (verdict) => {
    const report = fixture(verdict);
    expect(pointers(report)).toEqual([]);
    const text = JSON.stringify(report);
    expect(text).toContain(`"verdict":"${verdict}"`);
  });

  it("an acknowledged soft rule is a pass that carries its ack (pass.json)", () => {
    const finding = JSON.stringify(fixture("pass"));
    expect(finding).toContain('"ack":{"source":"comment"');
  });
});

/** The table of section 3.3, read from the spec, not from the schema: [ends the run, only on a required item]. */
const TABLE: Readonly<Record<Verdict, readonly [boolean, boolean]>> = {
  pass: [false, false],
  fail: [true, false],
  refuse: [true, false],
  "ack-missing": [true, false],
  skip: [false, false],
  "not-run": [true, false],
  "not-evaluated": [true, true],
  vacuous: [false, false],
};

describe("G1d endsRun follows the failure table", () => {
  it.each(VERDICTS)("%s on a required item", (verdict) => {
    expect(endsRun(verdict, true)).toBe(TABLE[verdict][0]);
  });

  it.each(VERDICTS)("%s on an item that is not required", (verdict) => {
    const [ends, onlyWhenRequired] = TABLE[verdict];
    expect(endsRun(verdict, false)).toBe(ends && !onlyWhenRequired);
  });
});

describe("G1e validateReport counts what the failure table ends the run on", () => {
  it("counts a required not-evaluated layer in failed, as well as in not_evaluated", () => {
    const report = fixture("not-evaluated");
    expect(pointers(report)).toEqual([]);
    expect(pointers(edit(report, ["counts", "failed"], 0))).toEqual(["/counts/failed"]);
  });

  it("does not count a vacuous layer as a failure, and the run passes", () => {
    const report = fixture("vacuous");
    expect(JSON.stringify(report)).toContain('"passed":true');
    expect(pointers(edit(report, ["passed"], false))).toEqual(["/passed"]);
    expect(pointers(edit(report, ["counts", "failed"], 1))).toEqual(["/counts/failed"]);
  });

  it.each(["fail", "refuse", "ack-missing", "not-run"] as const)(
    "counts a %s layer in failed and refuses a pass",
    (verdict) => {
      const report = fixture(verdict);
      expect(pointers(report)).toEqual([]);
      expect(pointers(edit(report, ["passed"], true))).toEqual(["/passed"]);
    },
  );

  it("skip is neither a failure nor a layer in range", () => {
    expect(pointers(fixture("skip"))).toEqual([]);
    expect(JSON.stringify(fixture("skip"))).toContain('"in_range":6');
  });
});

describe("G1b section 3.3 is the one verdict table, marked as the shared-core seam", () => {
  const text = readFileSync(resolve(root, "WEB_TOPS.md"), "utf8");
  const start = text.indexOf("### 3.3 ");
  const end = text.indexOf("### 3.4 ");
  const section = text.slice(start, end);
  const outside = text.slice(0, start) + text.slice(end);

  it("finds section 3.3", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it("names itself the shared-core seam and points at the core schema", () => {
    expect(section).toContain("shared-core seam");
    expect(section).toContain("schema/core.schema.json");
  });

  it.each(VERDICTS)("defines %s in section 3.3 and nowhere else", (verdict) => {
    const row = `\n| \`${verdict}\` |`;
    expect(section).toContain(row);
    expect(outside).not.toContain(row);
  });
});
