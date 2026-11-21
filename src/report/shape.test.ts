import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_VERSION, VERDICTS, validateReport } from "../config/report.ts";
import { at, edit, get } from "../config/test-support.ts";

/** G2a to G2c: the report's shape (WEB_TOPS.md section 6.6), and the baseline as a projection of it. */

const root = resolve(import.meta.dirname, "../..");

function fixture(name: string): unknown {
  const value: unknown = JSON.parse(readFileSync(resolve(root, "fixtures/report", name), "utf8"));
  return value;
}

function pointers(report: unknown): string[] {
  const result = validateReport(report);
  return result.ok ? [] : result.problems.map((problem) => problem.pointer);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function names(value: unknown): string[] {
  return typeof value === "object" && value !== null ? Object.keys(value) : [];
}

function num(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error(`not a number: ${String(value)}`);
  }
  return value;
}

function layerOf(report: unknown, id: string): unknown {
  return list(get(report, "layers")).find((item) => get(item, "id") === id);
}

describe("G2a report_version, subject and run", () => {
  it("every verdict fixture and every shape fixture is a valid report of the new shape", () => {
    for (const name of [
      ...VERDICTS.map((verdict) => `${verdict}.json`),
      "shape/with-metrics.json",
      "shape/optional-not-evaluated.json",
    ]) {
      expect(pointers(fixture(name)), name).toEqual([]);
    }
  });

  it("report_version is the report format's own semver, 2.1.0 since a survivor carries its key, and apart from protocol", () => {
    expect(REPORT_VERSION).toBe("2.4.0");
    const report = fixture("pass.json");
    expect(get(report, "report_version")).toBe(REPORT_VERSION);
    expect(get(report, "report_version")).not.toBe(get(report, "protocol"));
  });

  it.each(["1.0.0", "1.0", "v2.0.0", "2.0.0-rc.1", 2, ""])("refuses report_version %j", (value) => {
    expect(pointers(edit(fixture("pass.json"), ["report_version"], value))).toEqual([
      "/report_version",
    ]);
  });

  it("accepts a later minor or patch of the same format", () => {
    expect(pointers(edit(fixture("pass.json"), ["report_version"], "2.2.3"))).toEqual([]);
  });

  it.each(["report_version", "subject", "run"])("refuses a report with no %s", (key) => {
    expect(pointers(edit(fixture("pass.json"), [key]))).toEqual([`/${key}`]);
  });

  it("subject names the package and the root the run judged, and nothing else", () => {
    expect(get(fixture("pass.json"), "subject")).toEqual({ package: "fixture", root: "." });
    expect(pointers(edit(fixture("pass.json"), ["subject", "root"]))).toEqual(["/subject/root"]);
    expect(pointers(edit(fixture("pass.json"), ["subject", "package"], ""))).toEqual([
      "/subject/package",
    ]);
    expect(pointers(edit(fixture("pass.json"), ["subject", "extra"], "x"))).toEqual([
      "/subject/extra",
    ]);
  });

  it("run holds the git SHA, bun, node, the tool versions and the seed", () => {
    const run = get(fixture("pass.json"), "run");
    expect(names(run).sort()).toEqual(["bun", "node", "seed", "sha", "tools"]);
    expect(get(run, "sha")).toMatch(/^[0-9a-f]{40}$/u);
    expect(names(get(run, "tools"))).toEqual(["eslint", "typescript", "vitest"]);
  });

  it.each([
    [["run", "sha"], "abc123"],
    [["run", "sha"], "0123456789ABCDEF0123456789ABCDEF01234567"],
    [["run", "bun"], 1],
    [["run", "tools", "eslint"], 9],
    [["run", "seed"], -1],
    [["run", "seed"], 1.5],
  ])("refuses %j set to %j", (path, value) => {
    expect(pointers(edit(fixture("pass.json"), path, value))).toEqual([`/${path.join("/")}`]);
  });

  it.each(["sha", "bun", "node", "seed"])("run.%s may be null: it could not be read", (key) => {
    expect(pointers(edit(fixture("pass.json"), ["run", key], null))).toEqual([]);
  });

  it.each(["sha", "bun", "node", "tools", "seed"])("run.%s is required", (key) => {
    expect(pointers(edit(fixture("pass.json"), ["run", key]))).toEqual([`/run/${key}`]);
  });
});

describe("G2b required on every layer and law, and counts.required_not_evaluated", () => {
  it("every layer carries required", () => {
    for (const item of list(get(fixture("pass.json"), "layers"))) {
      expect(get(item, "required")).toBe(true);
    }
    expect(pointers(edit(fixture("pass.json"), ["layers", "0", "required"]))).toEqual([
      "/layers/0/required",
    ]);
    expect(pointers(edit(fixture("pass.json"), ["layers", "0", "required"], "yes"))).toEqual([
      "/layers/0/required",
    ]);
  });

  it("a law finding may carry required, and only as a boolean", () => {
    expect(
      get(list(at(layerOf(fixture("refuse.json"), "laws"), ["findings"]))[0], "required"),
    ).toBe(true);
    expect(
      pointers(edit(fixture("refuse.json"), ["layers", "6", "findings", "0", "required"], 1)),
    ).toEqual(["/layers/6/findings/0/required"]);
  });

  it("counts.required_not_evaluated is required, and equals the required not-evaluated layers", () => {
    const report = fixture("not-evaluated.json");
    expect(at(report, ["counts", "required_not_evaluated"])).toBe(1);
    expect(pointers(edit(report, ["counts", "required_not_evaluated"]))).toEqual([
      "/counts/required_not_evaluated",
    ]);
    expect(pointers(edit(report, ["counts", "required_not_evaluated"], 0))).toEqual([
      "/counts/required_not_evaluated",
    ]);
    expect(pointers(edit(fixture("pass.json"), ["counts", "required_not_evaluated"], 1))).toEqual([
      "/counts/required_not_evaluated",
    ]);
  });

  it("a required not-evaluated layer is in failed, in not_evaluated and in required_not_evaluated", () => {
    const counts = get(fixture("not-evaluated.json"), "counts");
    expect(counts).toMatchObject({
      failed: 1,
      not_evaluated: 1,
      required_not_evaluated: 1,
    });
  });

  it("a not-evaluated layer that is not required is counted and printed but does not end the run", () => {
    const report = fixture("shape/optional-not-evaluated.json");
    expect(get(report, "counts")).toMatchObject({
      failed: 0,
      not_evaluated: 1,
      required_not_evaluated: 0,
    });
    expect(get(report, "passed")).toBe(true);
    expect(pointers(report)).toEqual([]);
    expect(pointers(edit(report, ["passed"], false))).toEqual(["/passed"]);
  });

  it("the same layer, marked required, ends the run: the counts and passed follow required", () => {
    const report = edit(
      fixture("shape/optional-not-evaluated.json"),
      ["layers", "6", "required"],
      true,
    );
    expect(pointers(report).sort()).toEqual(
      ["/counts/failed", "/counts/required_not_evaluated", "/passed"].sort(),
    );
  });
});

describe("G2c metrics in the shapes the baseline needs", () => {
  const report = fixture("shape/with-metrics.json");

  it("every layer carries metrics, an empty object until it has some", () => {
    for (const item of list(get(report, "layers"))) {
      expect(typeof get(item, "metrics")).toBe("object");
    }
    expect(get(layerOf(fixture("pass.json"), "tests"), "metrics")).toEqual({});
    expect(pointers(edit(fixture("pass.json"), ["layers", "0", "metrics"]))).toEqual([
      "/layers/0/metrics",
    ]);
  });

  it("CRAP rows are {file, name, line, complexity, coverage, crap}", () => {
    const row = list(at(layerOf(report, "crap"), ["metrics", "crap"]))[0];
    expect(names(row).sort()).toEqual(["complexity", "coverage", "crap", "file", "line", "name"]);
    for (const key of ["file", "name", "line", "complexity", "coverage", "crap"]) {
      expect(pointers(edit(report, ["layers", "3", "metrics", "crap", "0", key]))).toEqual([
        `/layers/3/metrics/crap/0/${key}`,
      ]);
    }
    expect(
      pointers(edit(report, ["layers", "3", "metrics", "crap", "0", "coverage"], 1.5)),
    ).toEqual(["/layers/3/metrics/crap/0/coverage"]);
  });

  it("coverage rows are {file, lines_found, lines_hit}", () => {
    const row = list(at(layerOf(report, "coverage"), ["metrics", "coverage"]))[0];
    expect(names(row).sort()).toEqual(["file", "lines_found", "lines_hit"]);
    expect(
      pointers(edit(report, ["layers", "2", "metrics", "coverage", "0", "lines_hit"])),
    ).toEqual(["/layers/2/metrics/coverage/0/lines_hit"]);
  });

  it("finding rows are {rule, file, count} and page rows are {route, bytes}", () => {
    const finding = list(at(layerOf(report, "hygiene"), ["metrics", "findings"]))[0];
    expect(names(finding).sort()).toEqual(["count", "file", "rule"]);
    const page = list(at(layerOf(report, "build-output"), ["metrics", "pages"]))[0];
    expect(names(page).sort()).toEqual(["bytes", "route"]);
    expect(
      pointers(edit(report, ["layers", "0", "metrics", "findings", "0", "count"], -1)),
    ).toEqual(["/layers/0/metrics/findings/0/count"]);
    expect(
      pointers(edit(report, ["layers", "5", "metrics", "pages", "0", "bytes"], "big")),
    ).toEqual(["/layers/5/metrics/pages/0/bytes"]);
  });

  const keysOf = (value: unknown): string[] =>
    typeof value === "object" && value !== null ? Object.keys(value) : [];

  it("the mutation layer's metrics hold one count for each Stryker status (R75)", () => {
    const counts = at(layerOf(report, "mutation"), ["metrics", "mutation"]);
    expect(keysOf(counts).sort()).toEqual([
      "compile_error",
      "ignored",
      "killed",
      "no_coverage",
      "runtime_error",
      "survived",
      "timeout",
    ]);
    expect(pointers(report)).toEqual([]);
    for (const key of keysOf(counts)) {
      expect(pointers(edit(report, ["layers", "4", "metrics", "mutation", key]))).toEqual([
        `/layers/4/metrics/mutation/${key}`,
      ]);
    }
    expect(pointers(edit(report, ["layers", "4", "metrics", "mutation", "killed"], -1))).toEqual([
      "/layers/4/metrics/mutation/killed",
    ]);
    expect(pointers(edit(report, ["layers", "4", "metrics", "mutation", "killed"], 1.5))).toEqual([
      "/layers/4/metrics/mutation/killed",
    ]);
    expect(pointers(edit(report, ["layers", "4", "metrics", "mutation", "other"], 1))).toEqual([
      "/layers/4/metrics/mutation/other",
    ]);
  });

  it("only the mutation layer carries mutation metrics, and it carries no other kind", () => {
    const counts = at(layerOf(report, "mutation"), ["metrics", "mutation"]);
    const onCrap = edit(report, ["layers", "3", "metrics", "mutation"], counts);
    expect(pointers(onCrap).some((pointer) => pointer.startsWith("/layers/3/metrics"))).toBe(true);
    const crapOnMutation = edit(report, ["layers", "4", "metrics", "crap"], []);
    expect(
      pointers(crapOnMutation).some((pointer) => pointer.startsWith("/layers/4/metrics")),
    ).toBe(true);
  });

  it("a layer carries only the metrics of its own kind", () => {
    const crapOnTests = edit(report, ["layers", "1", "metrics"], { crap: [] });
    expect(pointers(crapOnTests).some((pointer) => pointer.startsWith("/layers/1/metrics"))).toBe(
      true,
    );
    const stray = edit(report, ["layers", "3", "metrics", "other"], []);
    expect(pointers(stray).some((pointer) => pointer.startsWith("/layers/3/metrics"))).toBe(true);
  });
});

/** The projection section 6.6 describes: every value comes from the report, and nothing else is read. */
function baselineOf(source: unknown): unknown {
  const metric = (id: string, key: string): unknown[] =>
    list(at(layerOf(source, id), ["metrics", key]));
  const crap = Object.fromEntries(
    metric("crap", "crap").map((row) => [
      `${String(get(row, "file"))}::${String(get(row, "name"))}`,
      {
        complexity: get(row, "complexity"),
        coverage: get(row, "coverage"),
        crap: get(row, "crap"),
      },
    ]),
  );
  const rows = metric("coverage", "coverage");
  const sum = (key: string): number =>
    rows.reduce<number>((total, row) => total + num(get(row, key)), 0);
  const findings: Record<string, Record<string, unknown>> = {};
  for (const row of metric("hygiene", "findings")) {
    const rule = String(get(row, "rule"));
    findings[rule] = { ...findings[rule], [String(get(row, "file"))]: get(row, "count") };
  }
  const pages = Object.fromEntries(
    metric("build-output", "pages").map((row) => [String(get(row, "route")), get(row, "bytes")]),
  );
  return {
    report_version: get(source, "report_version"),
    subject: get(source, "subject"),
    crap,
    coverage: {
      [String(at(source, ["subject", "package"]))]: {
        lines_found: sum("lines_found"),
        lines_hit: sum("lines_hit"),
      },
    },
    findings,
    pages,
  };
}

describe("G2c a baseline example derives from a report example with no other input", () => {
  const report = fixture("shape/with-metrics.json");

  it("projects fixtures/report/shape/baseline.json from fixtures/report/shape/with-metrics.json", () => {
    expect(baselineOf(report)).toEqual(fixture("shape/baseline.json"));
  });

  it("holds CRAP per function, coverage per package, finding counts per rule per file and bytes per page", () => {
    const baseline = fixture("shape/baseline.json");
    expect(names(baseline).sort()).toEqual([
      "coverage",
      "crap",
      "findings",
      "pages",
      "report_version",
      "subject",
    ]);
    expect(at(baseline, ["coverage", "fixture"])).toEqual({ lines_found: 40, lines_hit: 31 });
    expect(at(baseline, ["pages", "/about"])).toBe(9120);
    expect(at(baseline, ["findings", "@typescript-eslint/no-explicit-any", "src/wire.ts"])).toBe(1);
  });

  it("changes when the report's metrics change, and takes its version and subject from the report", () => {
    const changed = edit(report, ["layers", "5", "metrics", "pages", "0", "bytes"], 20000);
    expect(at(baselineOf(changed), ["pages", "/"])).toBe(20000);
    const moved = edit(report, ["subject", "package"], "other");
    expect(names(get(baselineOf(moved), "coverage"))).toEqual(["other"]);
    expect(get(baselineOf(edit(report, ["report_version"], "1.1.0")), "report_version")).toBe(
      "1.1.0",
    );
  });
});

describe("G2 section 6.6 documents replay with --sequence.seed", () => {
  const text = readFileSync(resolve(root, "WEB_TOPS.md"), "utf8");
  const start = text.indexOf("\n### 6.6 ");
  const section = text.slice(start, text.indexOf("\n### 6.7 "));

  it("says how a shuffled failure is rerun from the report", () => {
    expect(section).toContain("--sequence.seed");
    expect(section).toContain("`run.seed`");
  });

  it("says an unreadable run value is null and changes no verdict, and a layer's metrics are never absent (R53)", () => {
    expect(section).toContain("is `null` and changes no verdict");
    expect(section).toContain("never absent");
  });

  it("states report_version changes only when the shape does, and names the new fields", () => {
    expect(section).toContain("report_version");
    expect(section).toContain("only when the report's shape does");
    expect(section).toContain("required_not_evaluated");
  });
});
