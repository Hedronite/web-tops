import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Report } from "../report/types.ts";
import { runGate } from "./runner.ts";
import { buildRegistry } from "./registry.ts";
import { cfg, fakeLayer, noExec, off, opts, tempProject, tickingClock } from "./testkit.ts";
import type { Consumed, GateConfig, GateOptions, Layer } from "./types.ts";

/** R29 N5: layers declare the artifacts they produce and consume; a missing input is `not-run`, a present one is judged. */

const projects: ReturnType<typeof tempProject>[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    project.cleanup();
  }
});

interface Fixture {
  readonly dir: string;
  readonly outDir: string;
  /** Writes a file under `.web-tops/out` and returns its absolute path. */
  readonly write: (relative: string, text?: string) => string;
  readonly run: (
    layers: readonly Layer[],
    config?: GateConfig,
    options?: GateOptions,
  ) => Promise<Report>;
}

function fixture(): Fixture {
  const project = tempProject();
  projects.push(project);
  const outDir = join(project.dir, ".web-tops", "out");
  return {
    dir: project.dir,
    outDir,
    write: (relative, text = "data\n") => {
      const path = join(outDir, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      return path;
    },
    run: (layers, config = cfg(), options = opts()) =>
      runGate({
        layers,
        config,
        options,
        cwd: project.dir,
        env: {},
        exec: noExec,
        outDir,
        now: tickingClock(),
      }),
  };
}

function entryOf(report: Report, id: string): Report["layers"][number] {
  const found = report.layers.find((layer) => layer.id === id);
  if (found === undefined) {
    throw new Error(`no layer ${id} in the report`);
  }
  return found;
}

function pair(
  box: Fixture,
  producer: { verdict?: "pass" | "fail" | "not-evaluated"; write?: boolean },
  calls: string[] = [],
): readonly [Layer, Layer] {
  const path = join(box.outDir, "tests", "results.json");
  if (producer.write !== false) {
    box.write("tests/results.json");
  }
  return [
    fakeLayer({
      id: "tests",
      gate: 2,
      verdict: producer.verdict ?? "pass",
      calls,
      produces: ["results"],
      artifacts: { results: path },
    }),
    fakeLayer({
      id: "coverage",
      gate: 3,
      calls,
      requires: ["tests"],
      consumes: [{ artifact: "results", from: "tests" }],
    }),
  ];
}

describe("G2c hand-offs: produces, consumes and a missing input (R29 N5)", () => {
  it("runs a layer whose input exists and lists the producer's artifact in the report", async () => {
    const box = fixture();
    const calls: string[] = [];
    const report = await box.run(pair(box, {}, calls));
    expect(calls).toEqual(["tests", "coverage"]);
    expect(entryOf(report, "tests").artifacts).toEqual([".web-tops/out/tests/results.json"]);
    expect(report.passed).toBe(true);
  });

  it("hands a later layer the path of the artifact an earlier layer wrote this run", async () => {
    const box = fixture();
    let seen: string | undefined;
    const [writer, reader] = pair(box, {});
    const spy: Layer = {
      ...reader,
      run: (context) => {
        seen = context.artifacts.get("results");
        return Promise.resolve({ verdict: "pass", findings: [], artifacts: {} });
      },
    };
    await box.run([spy, writer]);
    expect(seen).toBe(join(box.outDir, "tests", "results.json"));
  });

  it("with --keep-going judges a layer whose input exists even when its producer failed", async () => {
    const box = fixture();
    const calls: string[] = [];
    const report = await box.run(
      pair(box, { verdict: "fail" }, calls),
      cfg(),
      opts({ keepGoing: true }),
    );
    expect(calls).toEqual(["tests", "coverage"]);
    expect(entryOf(report, "coverage").verdict).toBe("pass");
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(1);
  });

  it("without --keep-going a failed producer still stops the run, and the consumer says so", async () => {
    const box = fixture();
    const calls: string[] = [];
    const report = await box.run(pair(box, { verdict: "fail" }, calls));
    expect(calls).toEqual(["tests"]);
    expect(entryOf(report, "coverage")).toMatchObject({
      verdict: "not-run",
      reason: "stopped: gate 2 failed",
    });
  });

  it("gives not-run with the producer's verdict when a failed producer left no file", async () => {
    const box = fixture();
    const calls: string[] = [];
    const layers = pair(box, { verdict: "fail", write: false }, calls);
    const report = await box.run(layers, cfg(), opts({ keepGoing: true }));
    expect(calls).toEqual(["tests"]);
    expect(entryOf(report, "coverage")).toMatchObject({
      verdict: "not-run",
      reason: "input results missing: tests fail",
    });
    expect(report.counts).toEqual({
      in_range: 2,
      ran: 1,
      failed: 2,
      not_evaluated: 0,
      required_not_evaluated: 0,
    });
    expect(report.exit_code).toBe(1);
  });

  it("names a skipped producer: its toggle is off, so the input never existed", async () => {
    const box = fixture();
    const calls: string[] = [];
    const report = await box.run(
      pair(box, {}, calls),
      cfg({ toggles: { tests: off("tests are slow here") } }),
    );
    expect(calls).toEqual([]);
    expect(entryOf(report, "coverage")).toMatchObject({
      verdict: "not-run",
      reason: "input results missing: tests skip",
    });
    expect(report.passed).toBe(false);
  });

  it("does not list or hand on an artifact whose file was never written", async () => {
    const box = fixture();
    const calls: string[] = [];
    const report = await box.run(pair(box, { write: false }, calls));
    expect(calls).toEqual(["tests"]);
    expect(entryOf(report, "tests").artifacts).toEqual([]);
    expect(entryOf(report, "coverage").reason).toBe("input results missing: tests pass");
  });

  it("drops an artifact the layer did not declare, and one outside .web-tops/out/<layer>/", async () => {
    const box = fixture();
    const inside = box.write("tests/coverage/lcov.info");
    const undeclared = box.write("tests/other.txt");
    const otherLayer = box.write("crap/stolen.txt");
    const outside = join(box.dir, "elsewhere.txt");
    writeFileSync(outside, "x");
    const layer = fakeLayer({
      id: "tests",
      gate: 2,
      produces: ["lcov", "stolen", "away"],
      artifacts: { lcov: inside, other: undeclared, stolen: otherLayer, away: outside },
    });
    const report = await box.run([layer]);
    expect(entryOf(report, "tests").artifacts).toEqual([".web-tops/out/tests/coverage/lcov.info"]);
  });

  it("checks the input just before the layer runs, so a layer later in the order sees the earlier layers' files", async () => {
    const box = fixture();
    const calls: string[] = [];
    const layers = [
      ...pair(box, {}, calls),
      fakeLayer({
        id: "crap",
        gate: 4,
        calls,
        requires: ["tests"],
        consumes: [{ artifact: "results", from: "tests" }],
      }),
    ];
    const report = await box.run(layers);
    expect(calls).toEqual(["tests", "coverage", "crap"]);
    expect(report.passed).toBe(true);
  });

  it("under --only a layer pulls in its producer, so the input exists", async () => {
    const box = fixture();
    const calls: string[] = [];
    const report = await box.run(pair(box, {}, calls), cfg(), opts({ only: "coverage" }));
    expect(calls).toEqual(["tests", "coverage"]);
    expect(entryOf(report, "tests").reason).toBe("required by coverage");
  });
});

describe("G2f hand-offs: an input is matched by name and by the layer that produces it (R37)", () => {
  function twoProducers(box: Fixture, calls: string[], failFirst = false): Layer[] {
    const first = box.write("first/results.json", "first\n");
    const second = box.write("second/results.json", "second\n");
    return [
      fakeLayer({
        id: "first",
        gate: 1,
        calls,
        verdict: failFirst ? "fail" : "pass",
        produces: ["results"],
        artifacts: failFirst ? {} : { results: first },
      }),
      fakeLayer({
        id: "second",
        gate: 2,
        calls,
        produces: ["results"],
        artifacts: { results: second },
      }),
    ];
  }

  it("hands a consumer the artifact of the layer it names, not another layer's of the same name", async () => {
    const box = fixture();
    const seen: (string | undefined)[] = [];
    const consumer: Layer = {
      ...fakeLayer({ id: "third", gate: 3, consumes: [{ artifact: "results", from: "first" }] }),
      run: (context) => {
        seen.push(context.artifacts.get("results"));
        return Promise.resolve({ verdict: "pass", findings: [], artifacts: {} });
      },
    };
    await box.run([...twoProducers(box, []), consumer]);
    expect(seen).toEqual([join(box.outDir, "first", "results.json")]);
  });

  it("is not-run when the named producer left nothing, even though another layer left the same name", async () => {
    const box = fixture();
    const calls: string[] = [];
    const consumer = fakeLayer({
      id: "third",
      gate: 3,
      calls,
      consumes: [{ artifact: "results", from: "first" }],
    });
    const report = await box.run(
      [...twoProducers(box, calls, true), consumer],
      cfg(),
      opts({ keepGoing: true }),
    );
    expect(calls).toEqual(["first", "second"]);
    expect(entryOf(report, "third")).toMatchObject({
      verdict: "not-run",
      reason: "input results missing: first fail",
    });
  });

  it("shows a layer only the inputs it declared", async () => {
    const box = fixture();
    const seen: number[] = [];
    const bystander: Layer = {
      ...fakeLayer({ id: "third", gate: 3 }),
      run: (context) => {
        seen.push(context.artifacts.size);
        return Promise.resolve({ verdict: "pass", findings: [], artifacts: {} });
      },
    };
    await box.run([...twoProducers(box, []), bystander]);
    expect(seen).toEqual([0]);
  });
});

describe("G2c the real registry declares its hand-offs", () => {
  const layers = buildRegistry(cfg());
  const byId = new Map(layers.map((layer) => [layer.id, layer]));

  const isRequired = (need: Consumed): boolean => need.optional !== true;

  it("never consumes from a layer it does not require", () => {
    const needs = layers.flatMap((layer) => layer.consumes.map((need) => [layer, need] as const));
    const allowedFrom = (layer: Layer, need: Consumed): boolean =>
      layer.requires.includes(need.from) ||
      (need.optional === true && need.from === "build-output");
    for (const [layer, need] of needs) {
      expect(allowedFrom(layer, need), `${layer.id} <- ${need.from}:${need.artifact}`).toBe(true);
    }
  });

  it("the producer declares what a layer consumes, but an optional input may be one it does not write (R92)", () => {
    const needs = layers.flatMap((layer) => layer.consumes.filter(isRequired));
    for (const need of needs) {
      expect(byId.get(need.from)?.produces).toContain(need.artifact);
    }
  });

  it("gives every layer a produces and a consumes list", () => {
    for (const layer of layers) {
      expect(Array.isArray(layer.produces)).toBe(true);
      expect(Array.isArray(layer.consumes)).toBe(true);
    }
  });
});
