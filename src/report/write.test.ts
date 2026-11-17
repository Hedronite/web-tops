import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cfg,
  fakeBuiltins,
  noExec,
  opts,
  parseReport,
  tempProject,
  tickingClock,
  type TempProject,
} from "../gate/testkit.ts";
import { runGate } from "../gate/runner.ts";
import { writeReport } from "./write.ts";
import { formatText } from "./text.ts";
import type { Report } from "./types.ts";

const projects: TempProject[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    project.cleanup();
  }
});

async function sample(
  verdicts: Record<string, "pass" | "Refuse" | "not-evaluated"> = {},
): Promise<Report> {
  return runGate({
    layers: fakeBuiltins([], verdicts),
    config: cfg(),
    options: opts({ keepGoing: true }),
    cwd: "/unused",
    env: {},
    exec: noExec,
    outDir: "/unused",
    now: tickingClock(),
  });
}

describe("G2d report: written to report.path, valid against the schema, text printed", () => {
  it("writes the report as JSON to the given path, creating directories", async () => {
    const project = tempProject();
    projects.push(project);
    const path = join(project.dir, "nested", "deeper", "report.json");
    const report = await sample({ tests: "Refuse" });
    writeReport(path, report);
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(parseReport(text)).toEqual(report);
  });

  it("has every registered layer, with a reason on every skip and on every not-run", async () => {
    const report = await sample({ coverage: "not-evaluated" });
    expect(report.layers).toHaveLength(7);
    for (const layer of report.layers) {
      if (layer.verdict === "skip" || layer.verdict === "not-evaluated") {
        expect(layer.reason).toBeTruthy();
      }
    }
    expect(report.counts.not_evaluated).toBe(1);
  });

  it("prints text with each layer, its verdict, its reason and its findings, and the counts", async () => {
    const report = await runGate({
      layers: fakeBuiltins([], { tests: "Refuse" }),
      config: cfg(),
      options: opts(),
      cwd: "/unused",
      env: {},
      exec: noExec,
      outDir: "/unused",
      now: tickingClock(),
    });
    const text = formatText(report);
    expect(text).toContain("webtops gate  ts-library  hard  protocol 0.2.1");
    expect(text).toMatch(/hygiene\s+tier 1\s+pass/);
    expect(text).toMatch(/tests\s+tier 1\s+Refuse\s+fake Refuse/);
    expect(text).toMatch(/coverage\s+tier 1\s+not-run\s+stopped: gate 2 failed/);
    expect(text).toContain("layers: 7 in range, 2 ran, 6 failed, 0 not-evaluated");
    expect(text).toContain("gate failed (exit 1)");
  });

  it("prints findings under their layer and marks an advisory run as not enforced", () => {
    const report: Report = {
      ...parseReportFixture(),
      enforce: "advisory",
      enforced: false,
      layers: [
        {
          id: "hygiene",
          gate: 1,
          tier: 1,
          verdict: "Refuse",
          reason: "1 finding",
          findings: [
            {
              rule: "output-empty",
              verdict: "Refuse",
              message: "eslint wrote nothing",
              file: ".web-tops/out/eslint.json",
              line: 3,
            },
          ],
          artifacts: {},
          duration_ms: 5,
        },
      ],
      problems: [{ path: "/counts/ran", message: "ran 1 of 2 layers in range" }],
    };
    const text = formatText(report);
    expect(text).toContain(
      "- [Refuse] output-empty: eslint wrote nothing (.web-tops/out/eslint.json:3)",
    );
    expect(text).toContain("problem: ran 1 of 2 layers in range (/counts/ran)");
    expect(text).toContain("not enforced (advisory)");
  });
});

function parseReportFixture(): Report {
  return {
    protocol: "0.2.1",
    package: "p",
    class: "ts-library",
    enforce: "hard",
    enforced: true,
    base: "origin/main",
    max_tier: 1,
    keep_going: false,
    only: null,
    passed: true,
    exit_code: 0,
    counts: { in_range: 1, ran: 1, failed: 0, not_evaluated: 0 },
    problems: [],
    layers: [],
  };
}
