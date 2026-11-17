import { describe, expect, it } from "vitest";
import { LAYER_IDS, VERDICTS, validateReport, type GateReport } from "./report.ts";
import { containing, edit, get } from "./test-support.ts";
import { buildLayer, buildReport } from "./test-support-report.ts";

function pointers(report: unknown): string[] {
  const result = validateReport(report);
  return result.ok ? [] : result.problems.map((problem) => problem.pointer);
}

describe("G1b: gate-report.schema.json covers section 6.6 and every section 3.3 verdict", () => {
  it("accepts an all-pass report", () => {
    expect(validateReport(buildReport())).toEqual({ ok: true, value: buildReport() });
  });

  it.each(VERDICTS)("accepts a layer with verdict %s", (verdict) => {
    expect(pointers(buildReport({ crap: verdict }))).toEqual([]);
  });

  it("a layer without a verdict fails, naming the layer", () => {
    expect(pointers(edit(buildReport(), ["layers", "3", "verdict"]))).toEqual(["/layers/3/verdict"]);
  });

  it("a verdict outside section 3.3 fails", () => {
    expect(pointers(edit(buildReport(), ["layers", "3", "verdict"], "Maybe"))).toEqual(["/layers/3/verdict"]);
    expect(pointers(edit(buildReport(), ["layers", "3", "verdict"], "pass "))).toEqual(["/layers/3/verdict"]);
  });

  it.each([["skip"], ["not-run"]] as const)("%s without a reason fails", (verdict) => {
    expect(pointers(edit(buildReport({ crap: verdict }), ["layers", "3", "reason"]))).toEqual(["/layers/3/reason"]);
    expect(pointers(edit(buildReport({ crap: verdict }), ["layers", "3", "reason"], "  "))).toEqual([
      "/layers/3/reason",
    ]);
  });

  it("a not-evaluated layer needs no reason, and any verdict may carry one", () => {
    expect(pointers(edit(buildReport({ crap: "not-evaluated" }), ["layers", "3", "reason"], "tool off"))).toEqual([]);
    expect(pointers(edit(buildReport(), ["layers", "3", "reason"], "kept"))).toEqual([]);
  });

  it("every built-in layer must be present, and a custom one may be added", () => {
    const report = buildReport();
    const without = { ...report, layers: report.layers.filter((layer) => layer.id !== "crap") };
    expect(pointers(without)).toEqual(["/layers"]);
    expect(validateReport(without)).toEqual({
      ok: false,
      problems: [{ pointer: "/layers", message: 'layer "crap" is missing' }],
    });
    const bare = { ...report, layers: [] };
    expect(new Set(pointers(bare))).toEqual(new Set(["/layers"]));
    expect(get(validateReport(bare), "problems")).toHaveLength(LAYER_IDS.length);
    const custom = buildReport({}, { extra: [buildLayer("bundle-check", 6)] });
    expect(pointers(custom)).toEqual([]);
  });

  it("a layer id must be a lower-case token", () => {
    expect(pointers(edit(buildReport(), ["layers", "0", "id"], "Hygiene"))).toContain("/layers/0/id");
  });

  it("a layer listed twice fails", () => {
    const report = buildReport();
    const twice = { ...report, layers: [...report.layers, buildLayer("tests", 2)] };
    expect(pointers(twice)).toContain("/layers");
  });

  it("requires gate, tier and findings on a layer", () => {
    for (const key of ["gate", "tier", "findings"]) {
      expect(pointers(edit(buildReport(), ["layers", "0", key])), key).toEqual([`/layers/0/${key}`]);
    }
  });

  it("gate is 1 to 6 or laws", () => {
    expect(pointers(edit(buildReport(), ["layers", "0", "gate"], 7))).toContain("/layers/0/gate");
    expect(pointers(edit(buildReport(), ["layers", "0", "gate"], "laws"))).toEqual([]);
    expect(pointers(edit(buildReport(), ["layers", "0", "gate"], "other"))).toContain("/layers/0/gate");
  });

  it("tier is 0 to 3", () => {
    expect(pointers(edit(buildReport(), ["layers", "0", "tier"], 4))).toEqual(["/layers/0/tier"]);
    expect(pointers(edit(buildReport(), ["max_tier"], -1))).toEqual(["/max_tier"]);
  });

  it("requires every section 6.6 field and nothing unlisted", () => {
    for (const key of ["protocol", "class", "enforce", "enforced", "max_tier", "only", "counts", "layers"]) {
      expect(pointers(edit(buildReport(), [key])), key).toContain(`/${key}`);
    }
    for (const key of ["in_range", "ran", "failed", "not_evaluated"]) {
      expect(pointers(edit(buildReport(), ["counts", key])), key).toEqual([`/counts/${key}`]);
    }
    expect(pointers(edit(buildReport(), ["zz"], 1))).toEqual(["/zz"]);
    expect(pointers(edit(buildReport(), ["counts", "zz"], 1))).toEqual(["/counts/zz"]);
    expect(pointers(edit(buildReport(), ["protocol"], "0.2.0"))).toEqual(["/protocol"]);
  });

  it("`only` is a layer name or null", () => {
    expect(pointers({ ...buildReport(), only: "tests" })).toEqual([]);
    expect(pointers(edit(buildReport(), ["only"], 3))).toEqual(["/only"]);
  });

  it("takes the optional fields the runner writes, and checks their types", () => {
    const full: GateReport = {
      ...buildReport(),
      package: "pkg",
      base: "origin/main",
      keep_going: true,
      exit_code: 0,
      problems: [{ path: "/x", message: "m" }],
    };
    expect(pointers(full)).toEqual([]);
    expect(pointers({ ...buildReport(), base: null })).toEqual([]);
    const bad: [string[], unknown, string][] = [
      [["package"], "", "/package"],
      [["base"], 3, "/base"],
      [["keep_going"], "yes", "/keep_going"],
      [["passed"], "yes", "/passed"],
      [["exit_code"], 5, "/exit_code"],
      [["exit_code"], 1.5, "/exit_code"],
      [["problems"], [{ path: "/x" }], "/problems/0/message"],
      [["problems"], [{ path: "/x", message: "m", zz: 1 }], "/problems/0/zz"],
    ];
    for (const [path, value, pointer] of bad) {
      expect(pointers(edit(full, path, value)), path.join(".")).toContain(pointer);
    }
  });

  it("a layer takes artifacts as a list of paths and duration_ms as a count", () => {
    const layer = (extra: object) => ({ ...buildLayer("tests", 2), ...extra });
    const report = (extra: object): GateReport => {
      const base = buildReport();
      return { ...base, layers: base.layers.map((entry) => (entry.id === "tests" ? layer(extra) : entry)) };
    };
    expect(pointers(report({ artifacts: [".web-tops/out/lcov.info"], duration_ms: 0 }))).toEqual([]);
    expect(pointers(report({ artifacts: { lcov: "x" } }))).toEqual(["/layers/1/artifacts"]);
    expect(pointers(report({ artifacts: [""] }))).toEqual(["/layers/1/artifacts/0"]);
    expect(pointers(report({ duration_ms: -1 }))).toEqual(["/layers/1/duration_ms"]);
    expect(pointers(report({ duration_ms: 1.5 }))).toEqual(["/layers/1/duration_ms"]);
  });
});

describe("a finding has rule, message and verdict, and file and line when it has a place", () => {
  const withFinding = (finding: unknown): unknown =>
    edit(buildReport({ hygiene: "Refuse" }), ["layers", "0", "findings"], [finding]);

  it("accepts the minimal finding and one with a place", () => {
    expect(pointers(withFinding({ rule: "no-explicit-any", message: "m", verdict: "Refuse" }))).toEqual([]);
    expect(pointers(withFinding({ rule: "W-01", message: "m", verdict: "Refuse", file: "src/a.ts", line: 3 }))).toEqual([]);
  });

  it.each(["rule", "message", "verdict"])("requires %s", (key) => {
    const finding = { rule: "r", message: "m", verdict: "Refuse" };
    expect(pointers(withFinding(edit(finding, [key])))).toEqual([`/layers/0/findings/0/${key}`]);
  });

  it("refuses path (the place is file and line), a line below 1 and a verdict outside section 3.3", () => {
    const finding = { rule: "r", message: "m", verdict: "Refuse" };
    expect(pointers(withFinding({ ...finding, path: "a.ts" }))).toEqual(["/layers/0/findings/0/path"]);
    expect(pointers(withFinding({ ...finding, line: 0 }))).toEqual(["/layers/0/findings/0/line"]);
    expect(pointers(withFinding({ ...finding, file: "" }))).toEqual(["/layers/0/findings/0/file"]);
    expect(pointers(withFinding({ ...finding, verdict: "Maybe" }))).toEqual(["/layers/0/findings/0/verdict"]);
  });

  it.each(VERDICTS)("takes %s as a finding verdict", (verdict) => {
    expect(pointers(withFinding({ rule: "r", message: "m", verdict }))).toEqual([]);
  });

  it("a skip finding records an unmapped or switched-off step, and the layer stays pass", () => {
    const skipped = { rule: "stylelint", verdict: "skip", message: "ts-library: no CSS" };
    const report = edit(buildReport(), ["layers", "0", "findings"], [skipped]);
    expect(pointers(report)).toEqual([]);
    expect(validateReport(report)).toMatchObject({ ok: true, value: { passed: true } });
    expect(pointers(edit(report, ["layers", "0", "findings", "0", "message"]))).toEqual([
      "/layers/0/findings/0/message",
    ]);
  });

  it("an acknowledged Ack finding carries source and reason", () => {
    const ack = { rule: "W-12", message: "m", verdict: "Ack", ack: { source: "ledger", reason: "bounded" } };
    expect(pointers(withFinding(ack))).toEqual([]);
    expect(pointers(withFinding({ ...ack, ack: { source: "memo", reason: "x" } }))).toEqual([
      "/layers/0/findings/0/ack/source",
    ]);
    expect(pointers(withFinding({ ...ack, ack: { source: "comment" } }))).toEqual([
      "/layers/0/findings/0/ack/reason",
    ]);
  });
});

describe("what a schema cannot say: counts, enforcement and the verdict", () => {
  it("the not_evaluated count equals the not-evaluated layers", () => {
    expect(pointers(edit(buildReport({ crap: "not-evaluated" }), ["counts", "not_evaluated"], 0))).toEqual([
      "/counts/not_evaluated",
    ]);
    expect(pointers(edit(buildReport(), ["counts", "not_evaluated"], 1))).toEqual(["/counts/not_evaluated"]);
  });

  it("the failed count is Refuse, unacknowledged Ack and not-run, and not-evaluated is not in it", () => {
    const report = buildReport({ tests: "Refuse", crap: "Ack", mutation: "not-run", laws: "not-evaluated" });
    expect(report.counts).toEqual({ in_range: 7, ran: 6, failed: 3, not_evaluated: 1 });
    expect(pointers(report)).toEqual([]);
    expect(pointers(edit(report, ["counts", "failed"], 4))).toEqual(["/counts/failed"]);
    expect(pointers(edit(report, ["counts", "failed"], 2))).toEqual(["/counts/failed"]);
  });

  it("more layers run than are in range is refused", () => {
    expect(pointers(edit(buildReport(), ["counts", "ran"], 8))).toContain("/counts/ran");
  });

  it("skip layers are not in range, and a pass needs every in-range layer to have run", () => {
    const report = buildReport({ crap: "skip", mutation: "skip" });
    expect(report.counts).toMatchObject({ in_range: 5, ran: 5 });
    expect(report.passed).toBe(true);
    expect(pointers(report)).toEqual([]);
  });

  it("a run with no layer in range is not a pass, and the report says so", () => {
    const allSkipped = buildReport({
      hygiene: "skip",
      tests: "skip",
      coverage: "skip",
      crap: "skip",
      mutation: "skip",
      "build-output": "skip",
      laws: "skip",
    });
    expect(allSkipped.counts).toEqual({ in_range: 0, ran: 0, failed: 0, not_evaluated: 0 });
    expect(allSkipped.passed).toBe(false);
    expect(pointers(allSkipped)).toEqual([]);
    const claimed = validateReport(edit(allSkipped, ["passed"], true));
    expect(claimed).toEqual({
      ok: false,
      problems: [{ pointer: "/passed", message: containing("no layer was in range") }],
    });
    expect(pointers(edit(allSkipped, ["passed"]))).toEqual([]);
    expect(pointers(buildReport({ tests: "skip" }))).toEqual([]);
  });

  it("a run that passed claims passed true, and any failure claims passed false", () => {
    expect(buildReport().passed).toBe(true);
    expect(pointers(edit(buildReport(), ["passed"], false))).toEqual(["/passed"]);
    for (const verdict of ["Refuse", "Ack", "not-run", "not-evaluated"] as const) {
      const report = buildReport({ tests: verdict });
      expect(report.passed, verdict).toBe(false);
      expect(pointers(edit(report, ["passed"], true)), verdict).toEqual(["/passed"]);
    }
  });

  it("fewer layers ran than are in range cannot pass", () => {
    const report = edit(buildReport(), ["counts", "ran"], 6);
    expect(pointers(report)).toEqual(["/passed"]);
  });

  it("`passed` is optional", () => {
    expect(pointers(edit(buildReport({ tests: "Refuse" }), ["passed"]))).toEqual([]);
  });

  it("enforced is false exactly under advisory, and an advisory run keeps its failing verdicts", () => {
    const advisory = buildReport({ tests: "Refuse" }, { enforce: "advisory" });
    expect(advisory.enforced).toBe(false);
    expect(pointers(advisory)).toEqual([]);
    expect(pointers({ ...advisory, passed: true })).toEqual([]);
    expect(pointers(edit(advisory, ["enforced"], true))).toEqual(["/enforced"]);
    expect(pointers(edit(buildReport(), ["enforced"], false))).toEqual(["/enforced"]);
  });

  it("rejects what is not an object", () => {
    for (const value of [null, "x", 3, []]) expect(pointers(value), String(value)).toEqual([""]);
    expect(get(validateReport(null), "ok")).toBe(false);
  });
});
