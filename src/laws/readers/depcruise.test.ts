import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recorded } from "../../layers/hygiene/testkit.ts";
import { depcruiseReader, judgeCruise, readCruise } from "./depcruise.ts";
import { inputFor, lawOf } from "./testkit.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-depcruise-"));
  roots.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const CYCLE = lawOf("W-16", [{ tool: "dependency-cruiser", name: "no-circular" }]);
const UNRESOLVABLE = lawOf("W-17", [{ tool: "dependency-cruiser", name: "no-unresolvable" }]);

const report = (forbidden: readonly object[], violations: readonly object[] = []): string =>
  JSON.stringify({ summary: { violations, ruleSetUsed: { forbidden } } });

const RULE = { name: "no-circular", severity: "error" };

describe("judgeCruise: which violations a law reads", () => {
  const VIOLATIONS = [
    { rule: { name: "no-circular" }, from: "src/a.ts", to: "src/b.ts" },
    { rule: { name: "no-unresolvable" }, from: "src/c.ts", to: "./gone" },
    { from: "src/d.ts", to: "src/e.ts" },
    { rule: "no-circular", from: "src/f.ts", to: "src/g.ts" },
  ];
  const cruise = readCruise(
    report([RULE, { name: "no-unresolvable", severity: "error" }], VIOLATIONS),
  );

  it("takes the violations of the rule it maps, and no other", () => {
    const reading = judgeCruise(cruise ?? never(), CYCLE, undefined, false);
    expect(reading.findings).toEqual([
      {
        tool: "dependency-cruiser",
        rule: "no-circular",
        verdict: "refuse",
        message: "src/a.ts -> src/b.ts",
        file: "src/a.ts",
      },
    ]);
  });

  it("takes the violations of any rule it maps", () => {
    const both = lawOf("W-16", [
      { tool: "dependency-cruiser", name: "no-circular" },
      { tool: "dependency-cruiser", name: "no-unresolvable" },
    ]);
    const reading = judgeCruise(cruise ?? never(), both, undefined, false);
    expect(reading.findings.map((one) => one.file)).toEqual(["src/a.ts", "src/c.ts"]);
  });
});

function never(): never {
  throw new Error("the report did not read");
}

describe("readCruise", () => {
  it("reads the violations and the severity of each rule the run used", () => {
    const cruise = readCruise(recorded("depcruise-circular.json"));
    expect(cruise?.severities).toEqual(new Map([["no-circular", "error"]]));
    expect(cruise?.violations).toHaveLength(1);
  });

  it.each([undefined, "", "not json", "[]", '{"summary":{}}', '{"modules":[]}'])(
    "is undefined for %j",
    (text) => {
      expect(readCruise(text)).toBeUndefined();
    },
  );

  it("reads a run that has no ruleset as having no rule", () => {
    expect(readCruise('{"summary":{"violations":[]}}')?.severities).toEqual(new Map());
  });

  it("skips a rule with no name", () => {
    const cruise = readCruise(report([{ severity: "error" }, RULE]));
    expect(cruise?.severities).toEqual(new Map([["no-circular", "error"]]));
  });
});

describe("judgeCruise: a law is read from the ruleset the run used and its violations", () => {
  const cruise = (text: string) => {
    const read = readCruise(text);
    if (read === undefined) throw new Error("not a report");
    return read;
  };

  it("refuses a law for each violation of its rule, with the file and the edge", () => {
    expect(
      judgeCruise(cruise(recorded("depcruise-circular.json")), CYCLE, undefined, false),
    ).toEqual({
      law: "W-16",
      verdict: "refuse",
      findings: [
        {
          tool: "dependency-cruiser",
          rule: "no-circular",
          verdict: "refuse",
          message: "src/a.ts -> src/b.ts",
          file: "src/a.ts",
        },
      ],
    });
  });

  it("passes a law whose rule is at error and has no violation", () => {
    expect(judgeCruise(cruise(report([RULE])), CYCLE, undefined, false)).toEqual({
      law: "W-16",
      verdict: "pass",
      findings: [],
    });
  });

  it("does not count a violation of another law's rule", () => {
    const text = recorded("depcruise-circular.json");
    const read = cruise(text.replace('"no-circular"', '"no-circular"'));
    const other = cruise(
      report([RULE, { name: "no-unresolvable", severity: "error" }], read.violations),
    );
    expect(judgeCruise(other, UNRESOLVABLE, undefined, false).verdict).toBe("pass");
  });

  it("refuses a law whose rule the run did not have, at the line of the config that names it", () => {
    const config = 'module.exports = {\n  forbidden: [\n    { name: "no-circular" },\n  ],\n};\n';
    expect(judgeCruise(cruise(report([])), CYCLE, config, false)).toEqual({
      law: "W-16",
      verdict: "refuse",
      findings: [
        {
          tool: "dependency-cruiser",
          rule: "no-circular",
          verdict: "refuse",
          message: "the rule no-circular is not in the dependency-cruiser config",
          file: ".dependency-cruiser.cjs",
          line: 3,
        },
      ],
    });
  });

  it("names no line when there is no config, or the config does not name the rule", () => {
    const find = (config: string | undefined) =>
      judgeCruise(cruise(report([])), CYCLE, config, false).findings[0];
    expect(find(undefined)).not.toHaveProperty("line");
    expect(find("module.exports = {};\n")).not.toHaveProperty("line");
  });

  it("refuses a law whose rule the run had below error", () => {
    const warned = report([{ name: "no-circular", severity: "warn" }]);
    expect(judgeCruise(cruise(warned), CYCLE, undefined, false).findings[0]?.message).toBe(
      "the rule no-circular is at warn, below error",
    );
  });

  it("holds the violations under a ratchet baseline, and says how many", () => {
    expect(
      judgeCruise(cruise(recorded("depcruise-circular.json")), CYCLE, undefined, true),
    ).toEqual({ law: "W-16", verdict: "pass", findings: [], note: "1 held by the baseline" });
  });

  it("does not hold a rule that is off: the ratchet counts findings, not a lowered rule", () => {
    expect(judgeCruise(cruise(report([])), CYCLE, undefined, true).verdict).toBe("refuse");
  });
});

describe("depcruiseReader", () => {
  it("reads the artifact gate 1 kept, and the config in the project", async () => {
    const dir = project({
      "out/dependency-cruiser.json": report([]),
      ".dependency-cruiser.cjs": '{\n name: "no-circular",\n}\n',
    });
    const readings = await depcruiseReader(
      inputFor([CYCLE], {
        cwd: dir,
        artifacts: { "dependency-cruiser-json": join(dir, "out/dependency-cruiser.json") },
      }),
    );
    expect(readings[0]?.findings[0]).toMatchObject({ rule: "no-circular", line: 2 });
  });

  it("reads a project with no config file, and judges by the run alone", async () => {
    const dir = project({ "out/dc.json": report([RULE]) });
    const readings = await depcruiseReader(
      inputFor([CYCLE], {
        cwd: dir,
        artifacts: { "dependency-cruiser-json": join(dir, "out/dc.json") },
      }),
    );
    expect(readings).toEqual([{ law: "W-16", verdict: "pass", findings: [] }]);
  });

  it("holds under a ratchet baseline", async () => {
    const dir = project({ "out/dc.json": recorded("depcruise-circular.json") });
    const readings = await depcruiseReader(
      inputFor([CYCLE], {
        cwd: dir,
        held: true,
        artifacts: { "dependency-cruiser-json": join(dir, "out/dc.json") },
      }),
    );
    expect(readings[0]?.note).toBe("1 held by the baseline");
  });

  it.each([
    ["has no artifact", undefined],
    ["has an artifact that is no report", "not json"],
  ])(
    "is not evaluated when gate 1 %s: a tool that did not run is never a pass",
    async (_name, text) => {
      const dir = project(text === undefined ? {} : { "out/dc.json": text });
      const artifacts =
        text === undefined ? {} : { "dependency-cruiser-json": join(dir, "out/dc.json") };
      const readings = await depcruiseReader(
        inputFor([CYCLE, UNRESOLVABLE], { cwd: dir, artifacts }),
      );
      expect(readings.map((reading) => [reading.law, reading.verdict])).toEqual([
        ["W-16", "not-evaluated"],
        ["W-17", "not-evaluated"],
      ]);
      expect(readings[0]?.reason).toBe(
        "the dependency-cruiser output of gate 1 is missing or is not a depcruise JSON report",
      );
    },
  );
});
