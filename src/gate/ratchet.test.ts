import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson } from "../baseline/canonical.ts";
import type { Baseline } from "../baseline/types.ts";
import { validateReport } from "../config/report.ts";
import type { RawFinding } from "../report/findings.ts";
import type { Report } from "../report/types.ts";
import { cleanRepos, commit, git, makeRepo, write } from "../diff/test-support.ts";
import { loadGateConfig } from "./load.ts";
import { runGate } from "./runner.ts";
import { cfg, fakeBuiltins, fakeLayer, noExec, opts, tickingClock } from "./testkit.ts";
import type { GateConfig, Layer } from "./types.ts";

/** G9 (R67): under ratchet, what the run has above its baseline is a refuse finding on its layer. */

const made: string[] = [];

afterEach(() => {
  cleanRepos();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BASELINE = ".web-tops/baseline.json";

const BASE: Baseline = {
  report_version: "2.0.0",
  subject: { package: "fixture", root: "." },
  crap: { "src/a.ts::f": { complexity: 3, coverage: 1, crap: 3 } },
  coverage: {},
  findings: { "no-console": { "src/a.ts": 1 } },
  fingerprints: [],
  census: {},
  pages: {},
};

function project(baseline: Baseline | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-ratchet-"));
  made.push(dir);
  if (baseline !== undefined) {
    mkdirSync(join(dir, ".web-tops"));
    writeFileSync(join(dir, BASELINE), canonicalJson(baseline));
  }
  return dir;
}

const ratchet = (overrides: Partial<GateConfig> = {}): GateConfig =>
  cfg({ enforce: "ratchet", baselinePath: BASELINE, ...overrides });

function crapRows(crap: number, name = "f"): Layer {
  return fakeLayer({
    id: "crap",
    gate: 4,
    metrics: { crap: [{ file: "src/a.ts", name, line: 1, complexity: 3, coverage: 1, crap }] },
  });
}

const eslint = (line: number): RawFinding => ({
  tool: "eslint",
  rule: "no-console",
  verdict: "fail",
  message: "no console",
  file: "src/a.ts",
  line,
});

function layersWith(...replacements: Layer[]): Layer[] {
  return fakeBuiltins([]).map(
    (layer) => replacements.find((item) => item.id === layer.id) ?? layer,
  );
}

function run(dir: string, layers: Layer[], config: GateConfig = ratchet()): Promise<Report> {
  return runGate({
    layers,
    config,
    options: opts({ keepGoing: true }),
    cwd: dir,
    env: {},
    exec: noExec,
    outDir: join(dir, ".web-tops/out"),
    now: tickingClock(),
  });
}

function layer(report: Report, id: string): Report["layers"][number] {
  const found = report.layers.find((item) => item.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

describe("G9b: only the ratchet mode reads a baseline", () => {
  it("leaves a run above its baseline alone under hard, though the config names one", async () => {
    const report = await run(project(BASE), layersWith(crapRows(9)), ratchet({ enforce: "hard" }));
    expect(layer(report, "crap").verdict).toBe("pass");
    expect(layer(report, "crap").findings).toEqual([]);
    expect(report.passed).toBe(true);
  });
});

describe("G9b: a run above its baseline is refused, layer by layer", () => {
  it("passes a run that equals its baseline, and one that is below it", async () => {
    const same = await run(
      project(BASE),
      layersWith(crapRows(3), fakeLayer({ id: "hygiene", findings: [eslint(1)] })),
    );
    expect(same.passed).toBe(true);
    expect(same.exit_code).toBe(0);
    const below = await run(project(BASE), layersWith(crapRows(2)));
    expect(below.passed).toBe(true);
  });

  it("refuses a function whose CRAP rose, on the crap layer, with a fingerprinted finding", async () => {
    const report = await run(project(BASE), layersWith(crapRows(9)));
    expect(layer(report, "crap").verdict).toBe("refuse");
    const finding = layer(report, "crap").findings.find((item) => item.rule === "ratchet-crap-up");
    expect(finding).toMatchObject({
      tool: "webtops",
      verdict: "refuse",
      file: "src/a.ts",
      law: null,
    });
    expect(finding?.fingerprint).toMatch(/^fp1:[0-9a-f]{16}$/);
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(1);
    expect(validateReport(report).ok).toBe(true);
  });

  it("holds a new function to the cap the run is configured with", async () => {
    const over = await run(project(BASE), layersWith(crapRows(5, "g")), ratchet());
    expect(layer(over, "crap").findings.map((item) => item.rule)).toContain("ratchet-crap-new");
    const loose = await run(
      project(BASE),
      layersWith(crapRows(5, "g")),
      ratchet({ crap: { cap: 6, scope: "diff", nullishDiscount: true } }),
    );
    expect(loose.passed).toBe(true);
  });

  it("refuses a rise in a finding count on the hygiene layer, and keeps metrics.findings equal to its findings", async () => {
    const report = await run(
      project(BASE),
      layersWith(fakeLayer({ id: "hygiene", findings: [eslint(1), eslint(2)] })),
    );
    const hygiene = layer(report, "hygiene");
    expect(hygiene.findings.map((item) => item.rule)).toContain("ratchet-findings-up");
    expect(hygiene.verdict).toBe("refuse");
    expect(report.passed).toBe(false);
    expect(validateReport(report).ok).toBe(true);
  });

  it("refuses E3: a v8-ignore hint above a baseline of none, though coverage still passes", async () => {
    const hint: RawFinding = {
      tool: "webtops",
      rule: "coverage-hint/v8",
      verdict: "pass",
      message: "a v8 ignore hint takes lines out of the coverage profile",
      file: "src/guard.ts",
      line: 2,
    };
    const report = await run(
      project(BASE),
      layersWith(fakeLayer({ id: "coverage", gate: 3, findings: [hint] })),
    );
    expect(layer(report, "coverage").verdict).toBe("refuse");
    expect(layer(report, "coverage").findings.map((item) => item.rule)).toContain(
      "ratchet-census-up",
    );
    expect(report.exit_code).toBe(1);
    const held = await run(
      project({
        ...BASE,
        census: { "v8-ignore": { count: 1, fingerprints: ["fp1:0000000000000000"] } },
      }),
      layersWith(fakeLayer({ id: "coverage", gate: 3, findings: [hint] })),
    );
    expect(held.passed).toBe(true);
  });

  it("leaves a layer that already ends the run as it is, and adds the breach beside its findings", async () => {
    const report = await run(
      project(BASE),
      layersWith(
        fakeLayer({
          id: "crap",
          gate: 4,
          verdict: "fail",
          metrics: {
            crap: [{ file: "src/a.ts", name: "f", line: 1, complexity: 3, coverage: 1, crap: 9 }],
          },
        }),
      ),
    );
    expect(layer(report, "crap").verdict).toBe("fail");
    expect(layer(report, "crap").findings.map((item) => item.rule)).toContain("ratchet-crap-up");
  });

  it("does not read a baseline under hard or advisory", async () => {
    for (const enforce of ["hard", "advisory"] as const) {
      const report = await run(project(undefined), layersWith(crapRows(99)), ratchet({ enforce }));
      expect(layer(report, "crap").findings.map((item) => item.rule)).not.toContain(
        "ratchet-crap-up",
      );
    }
  });

  it("holds nothing when there is no baseline yet: the bootstrap state, in which the layers judge as hard does", async () => {
    const report = await run(project(undefined), layersWith(crapRows(99)));
    expect(layer(report, "crap").findings.map((item) => item.rule)).not.toContain(
      "ratchet-crap-up",
    );
    expect(layer(report, "hygiene").findings.map((item) => item.rule)).not.toContain(
      "baseline-unreadable",
    );
  });

  it("fails the hygiene layer when the baseline is there and cannot be read", async () => {
    const dir = project(undefined);
    mkdirSync(join(dir, ".web-tops"));
    writeFileSync(join(dir, BASELINE), "{}\n");
    const report = await run(dir, layersWith(crapRows(3)));
    expect(layer(report, "hygiene").findings.map((item) => item.rule)).toContain(
      "baseline-unreadable",
    );
    expect(report.passed).toBe(false);
  });
});

describe("G9c: the gate asks for the baseline's history before it runs a layer", () => {
  const YAML = `protocol: "0.3.0"\nversion: "1"\npackage: fixture\nclass: ts-library\nenforce: ratchet\nbaseline: ${BASELINE}\ngates:\n  mutation:\n    base: main\n`;

  function branched(head: Baseline): string {
    const dir = makeRepo({
      "web-tops.yaml": YAML,
      [BASELINE]: canonicalJson(BASE),
      "src/a.ts": "export const a = 1;\n",
    });
    git(dir, "switch", "-q", "-c", "feature");
    write(dir, { [BASELINE]: canonicalJson(head), "src/a.ts": "export const a = 2;\n" });
    commit(dir, "change");
    return dir;
  }

  it("loads the config when the baseline only tightened", async () => {
    expect(await loadGateConfig(branched({ ...BASE, findings: {} }))).toMatchObject({ ok: true });
  });

  it("stops with the reason, as a /baseline problem, when the change raised the baseline", async () => {
    const loaded = await loadGateConfig(
      branched({ ...BASE, findings: { "no-console": { "src/a.ts": 5 } } }),
    );
    expect(loaded).toMatchObject({ ok: false });
    expect(JSON.stringify(loaded)).toContain("web-tops.yaml /baseline: the baseline rose");
  });
});
