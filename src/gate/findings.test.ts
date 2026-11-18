import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateReport } from "../config/report.ts";
import type { RawFinding } from "../report/findings.ts";
import { formatText } from "../report/text.ts";
import type { Report } from "../report/types.ts";
import { runGate } from "./runner.ts";
import {
  cfg,
  fakeBuiltins,
  fakeLayer,
  noExec,
  opts,
  tempProject,
  tickingClock,
} from "./testkit.ts";
import type { Layer } from "./types.ts";

/** G1a, G1b: the runner gives every layer's findings the one shape, and derives the counts from them. */

const projects: ReturnType<typeof tempProject>[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    project.cleanup();
  }
});

const SOURCE = "const a = 1;\nconst unused = 2;\nconst b = 3;\n";

function project(files: Record<string, string> = { "src/run.ts": SOURCE }): string {
  const made = tempProject();
  projects.push(made);
  for (const [name, text] of Object.entries(files)) {
    const path = join(made.dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return made.dir;
}

function eslint(over: Partial<RawFinding> = {}): RawFinding {
  return {
    tool: "eslint",
    rule: "no-unused-vars",
    verdict: "fail",
    message: "unused",
    file: "src/run.ts",
    line: 2,
    ...over,
  };
}

/** All seven built-in layers, so the report validates; the hygiene layer says `findings`. */
function hygiene(findings: readonly RawFinding[]): Layer[] {
  const others = fakeBuiltins([]).filter((layer) => layer.id !== "hygiene");
  const own = fakeLayer({
    id: "hygiene",
    gate: 1,
    verdict: findings.length > 0 ? "fail" : "pass",
    findings,
  });
  return [own, ...others];
}

function run(dir: string, layers: readonly Layer[]): Promise<Report> {
  return runGate({
    layers,
    config: cfg(),
    options: opts(),
    cwd: dir,
    env: {},
    exec: noExec,
    outDir: join(dir, ".web-tops", "out"),
    now: tickingClock(),
  });
}

function findingsOf(report: Report, id: string): Report["layers"][number]["findings"] {
  return report.layers.find((layer) => layer.id === id)?.findings ?? [];
}

describe("G1a the runner completes every layer's findings", () => {
  it("adds law, a place or null, and a fingerprint, and the report validates", async () => {
    const report = await run(project(), [
      ...hygiene([
        eslint(),
        { tool: "audit", rule: "GHSA-1", verdict: "fail", message: "advisory" },
      ]),
    ]);
    const [first, second] = findingsOf(report, "hygiene");
    expect(first).toMatchObject({ tool: "eslint", law: null, file: "src/run.ts", line: 2 });
    expect(first?.fingerprint).toMatch(/^fp1:[0-9a-f]{16}$/u);
    expect(second).toMatchObject({ tool: "audit", law: null, file: null, line: null });
    expect(validateReport(report).ok).toBe(true);
  });

  it("gives the same fingerprint after an unrelated edit in the file, and another one after the flagged line changes", async () => {
    const first = await run(project(), hygiene([eslint()]));
    const moved = await run(
      project({ "src/run.ts": `// header\n${SOURCE}` }),
      hygiene([eslint({ line: 3 })]),
    );
    const changed = await run(
      project({ "src/run.ts": SOURCE.replace("unused = 2", "unused = 3") }),
      hygiene([eslint()]),
    );
    const key = (report: Report): string | undefined =>
      findingsOf(report, "hygiene")[0]?.fingerprint;
    expect(key(moved)).toBe(key(first));
    expect(key(changed)).not.toBe(key(first));
  });

  it("anchors on the message when the file is not there", async () => {
    const report = await run(project({}), hygiene([eslint()]));
    expect(findingsOf(report, "hygiene")[0]?.fingerprint).toMatch(/^fp1:/u);
  });

  it("completes the findings of every layer, not only hygiene", async () => {
    const layers = [
      fakeLayer({
        id: "tests",
        gate: 2,
        verdict: "fail",
        findings: [
          {
            tool: "vitest",
            rule: "test-failed",
            verdict: "fail",
            message: "boom",
            file: "src/run.ts",
          },
        ],
      }),
    ];
    const report = await run(project(), layers);
    expect(findingsOf(report, "tests")[0]).toMatchObject({ tool: "vitest", law: null, line: null });
    expect(findingsOf(report, "tests")[0]?.fingerprint).toMatch(/^fp1:/u);
  });
});

describe("G1b the runner derives metrics.findings from the findings", () => {
  const several = [
    eslint({ line: 1 }),
    eslint({ line: 2 }),
    eslint({ rule: "no-undef", line: 3 }),
    eslint({ file: "src/other.ts", line: 1 }),
  ];

  it("counts per rule per file on the hygiene layer", async () => {
    const dir = project({ "src/run.ts": SOURCE, "src/other.ts": SOURCE });
    const report = await run(dir, hygiene(several));
    expect(report.layers.find((layer) => layer.id === "hygiene")?.metrics).toEqual({
      findings: [
        { rule: "no-undef", file: "src/run.ts", count: 1 },
        { rule: "no-unused-vars", file: "src/other.ts", count: 1 },
        { rule: "no-unused-vars", file: "src/run.ts", count: 2 },
      ],
    });
    expect(validateReport(report).ok).toBe(true);
  });

  it("a layer cannot set its own count: what it reports is replaced by what its findings say", async () => {
    const lying = fakeLayer({
      id: "hygiene",
      gate: 1,
      verdict: "fail",
      findings: [eslint()],
      metrics: { findings: [{ rule: "no-unused-vars", file: "src/run.ts", count: 99 }] },
    });
    const report = await run(project(), [lying]);
    expect(report.layers[0]?.metrics.findings).toEqual([
      { rule: "no-unused-vars", file: "src/run.ts", count: 1 },
    ]);
  });

  it("a count the layer made up is dropped when its findings give none, and on a layer that does not count findings", async () => {
    const made = { findings: [{ rule: "no-unused-vars", file: "src/run.ts", count: 3 }] };
    const none = await run(project(), [
      fakeLayer({ id: "hygiene", gate: 1, metrics: made }),
      fakeLayer({ id: "tests", gate: 2, metrics: made }),
    ]);
    expect(none.layers.map((layer) => layer.metrics)).toEqual([{}, {}]);
  });

  it("a layer with no finding that has a file carries an empty metrics object", async () => {
    const report = await run(project(), hygiene([]));
    expect(report.layers[0]?.metrics).toEqual({});
  });
});

describe("G1 the report keeps every finding and only the printer caps", () => {
  const many = Array.from({ length: 250 }, (_unused, index) =>
    eslint({ rule: `rule-${String(index % 5)}`, line: (index % 3) + 1 }),
  );

  it("holds all 250 in the report, with counts that add up to 250", async () => {
    const report = await run(project(), hygiene(many));
    expect(findingsOf(report, "hygiene")).toHaveLength(250);
    const rows = report.layers[0]?.metrics.findings ?? [];
    expect(rows.reduce((total, row) => total + row.count, 0)).toBe(250);
    expect(validateReport(report).ok).toBe(true);
  });

  it("prints the first 100 and says how many more there are", async () => {
    const report = await run(project(), hygiene(many));
    const text = formatText(report);
    expect(text.split("\n").filter((line) => line.includes("] rule-")).length).toBe(100);
    expect(text).toContain("and 150 more findings, not listed");
  });

  it("prints nothing about more when 100 or fewer fit", async () => {
    const report = await run(project(), hygiene(many.slice(0, 100)));
    expect(formatText(report)).not.toContain("more findings");
  });
});
