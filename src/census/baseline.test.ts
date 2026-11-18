import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { censusKindOf } from "../baseline/census.ts";
import { ratchetBreaches } from "../baseline/compare.ts";
import { projectBaseline } from "../baseline/project.ts";
import { validateReport } from "../config/report.ts";
import type { Finding, GateReport } from "../config/report.ts";
import type { Exec } from "../gate/types.ts";
import { completeFindings } from "../report/findings.ts";
import { censusFindings } from "./index.ts";

const root = resolve(import.meta.dirname, "../..");
const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const source: unknown = JSON.parse(
  readFileSync(join(root, "fixtures/report/shape/with-metrics.json"), "utf8"),
);

function baseReport(): GateReport {
  const result = validateReport(source);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.value;
}

const withCoverageFindings = (base: GateReport, findings: readonly Finding[]): GateReport => ({
  ...base,
  layers: base.layers.map((layer) => (layer.id === "coverage" ? { ...layer, findings } : layer)),
});

const noExec: Exec = () => Promise.reject(new Error("no process should start"));

/** The census of a project's files, completed the way the runner completes a layer's findings. */
async function census(files: Readonly<Record<string, string>>): Promise<Finding[]> {
  mkdirSync(join(root, "tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, "tmp", "wt-census-base-"));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const raws = await censusFindings({
    cwd: dir,
    files: Object.keys(files),
    exec: noExec,
    env: {},
    outDir: join(dir, "out"),
  });
  return completeFindings(raws, (file) => files[file]);
}

describe("R75: the census findings reach the baseline census", () => {
  it("maps `census/<kind>` to the kind, keeps the coverage hints as they were, and ignores every other rule", () => {
    const finding = (rule: string): Finding => ({
      tool: "webtops",
      rule,
      law: null,
      verdict: "pass",
      message: "m",
      file: "a.ts",
      line: 1,
      fingerprint: "fp1:0000000000000000",
    });
    expect(censusKindOf(finding("census/eslint-disable"))).toBe("eslint-disable");
    expect(censusKindOf(finding("census/tsconfig-exclude"))).toBe("tsconfig-exclude");
    expect(censusKindOf(finding("coverage-hint/v8"))).toBe("v8-ignore");
    expect(censusKindOf(finding("no-console"))).toBeUndefined();
    expect(censusKindOf(finding("coverage"))).toBeUndefined();
  });

  const countOf = (
    projected: ReturnType<typeof projectBaseline>,
    kind: string,
  ): number | undefined => projected.census[kind]?.count;

  it("counts each directive by kind", async () => {
    const found = await census({
      "src/a.ts":
        "// @ts-ignore\nexport const a = 1;\n/* eslint-disable */\n// eslint-disable-next-line x\n",
      "src/b.css": "/* stylelint-disable */\n",
    });
    const projected = projectBaseline(withCoverageFindings(baseReport(), found));
    expect([
      countOf(projected, "ts-ignore"),
      countOf(projected, "eslint-disable"),
      countOf(projected, "stylelint-disable"),
    ]).toEqual([1, 2, 1]);
  });

  it("holds the fingerprint of each directive", async () => {
    const found = await census({
      "src/a.ts": "/* eslint-disable */\n// eslint-disable-next-line x\n",
    });
    const projected = projectBaseline(withCoverageFindings(baseReport(), found));
    expect(projected.census["eslint-disable"]?.fingerprints).toHaveLength(2);
  });

  const baselineOf = async (files: Readonly<Record<string, string>>) =>
    projectBaseline(withCoverageFindings(baseReport(), await census(files)));

  it("keeps a directive's fingerprint when it only moves", async () => {
    const base = await baselineOf({ "src/a.ts": "// @ts-ignore\nexport const a = 1;\n" });
    const moved = await baselineOf({
      "src/a.ts": "\n\n// header\nexport const x = 0;\n// @ts-ignore\nexport const a = 1;\n",
    });
    expect(moved.census["ts-ignore"]?.fingerprints).toEqual(base.census["ts-ignore"]?.fingerprints);
  });

  it("raises no breach when a directive only moves", async () => {
    const base = await baselineOf({ "src/a.ts": "// @ts-ignore\nexport const a = 1;\n" });
    const moved = await baselineOf({
      "src/a.ts": "\n\n// header\nexport const x = 0;\n// @ts-ignore\nexport const a = 1;\n",
    });
    expect(ratchetBreaches(base, moved, 4)).toEqual([]);
  });

  it("raises a breach when a directive is added: a count that rises fails under ratchet", async () => {
    const before = await census({ "src/a.ts": "// @ts-ignore\nexport const a = 1;\n" });
    const after = await census({
      "src/a.ts": "// @ts-ignore\nexport const a = 1;\n// @ts-ignore\nexport const b = 2;\n",
    });
    const base = projectBaseline(withCoverageFindings(baseReport(), before));
    const breaches = ratchetBreaches(
      base,
      projectBaseline(withCoverageFindings(baseReport(), after)),
      4,
    );
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ layer: "hygiene", rule: "ratchet-census-up" });
    expect(breaches[0]?.message).toContain("ts-ignore: 2 directives, above its baseline 1");
  });

  it("counts two directives of the same text in one file as two, not one", async () => {
    const found = await census({
      "src/a.ts": "// @ts-ignore\nconst a = 1;\n// @ts-ignore\nconst b = 2;\n",
    });
    const projected = projectBaseline(withCoverageFindings(baseReport(), found));
    expect(projected.census["ts-ignore"]?.count).toBe(2);
    expect(new Set(projected.census["ts-ignore"]?.fingerprints).size).toBe(2);
  });

  it("holds no census entry for a project with no directive", async () => {
    const found = await census({ "src/a.ts": "export const a = 1;\n" });
    expect(projectBaseline(withCoverageFindings(baseReport(), found)).census).toEqual({});
  });

  it("is never a counted finding: a census finding is a pass, and the baseline counts only what ends the run", async () => {
    const found = await census({ "src/a.ts": "// @ts-ignore\n" });
    expect(found.every((finding) => finding.verdict === "pass")).toBe(true);
    const projected = projectBaseline(withCoverageFindings(baseReport(), found));
    expect(Object.keys(projected.findings)).not.toContain("census/ts-ignore");
  });
});
