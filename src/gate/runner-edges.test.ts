import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { anchorOf, fingerprint } from "../report/findings.ts";
import type { Report } from "../report/types.ts";
import { optionsFor, runGate, sourceReader } from "./runner.ts";
import { cfg, fakeLayer, noExec, off, opts, tempProject, tickingClock } from "./testkit.ts";
import type { GateConfig, GateOptions, Layer, LayerContext } from "./types.ts";

/** The runner's edges: what a layer entry holds when nothing ran, when a layer threw, and what each input and stop does. */

const projects: ReturnType<typeof tempProject>[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    project.cleanup();
  }
});

function setup(): { dir: string; write: (name: string) => string; run: Run } {
  const project = tempProject();
  projects.push(project);
  const outDir = join(project.dir, ".web-tops", "out");
  return {
    dir: project.dir,
    write: (name) => {
      const path = join(outDir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "{}\n");
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

type Run = (
  layers: readonly Layer[],
  config?: GateConfig,
  options?: GateOptions,
) => Promise<Report>;

function entry(report: Report, id: string): Report["layers"][number] {
  const found = report.layers.find((layer) => layer.id === id);
  if (found === undefined) {
    throw new Error(`no ${id} in the report`);
  }
  return found;
}

describe("the entry of a layer that did not run", () => {
  it("has no findings, metrics or artifacts and took no time", async () => {
    const config = cfg({ toggles: { hygiene: off("not for this project") } });
    const report = await setup().run([fakeLayer({ id: "hygiene" })], config);
    const hygiene = entry(report, "hygiene");
    expect(hygiene.verdict).toBe("skip");
    expect(hygiene.findings).toStrictEqual([]);
    expect(hygiene.metrics).toStrictEqual({});
    expect(hygiene.artifacts).toStrictEqual([]);
    expect(hygiene.duration_ms).toBe(0);
  });
});

describe("a layer that throws", () => {
  it("fails with what it threw, as a finding of its own, in the time it took", async () => {
    const report = await setup().run([fakeLayer({ id: "hygiene", throws: new Error("boom") })]);
    const hygiene = entry(report, "hygiene");
    expect(hygiene.verdict).toBe("fail");
    expect(hygiene.reason).toBe("layer threw: boom");
    expect(hygiene.findings).toHaveLength(1);
    expect(hygiene.findings[0]).toMatchObject({
      tool: "webtops",
      rule: "layer-threw",
      verdict: "fail",
      message: "boom",
    });
    expect(hygiene.duration_ms).toBeGreaterThan(0);
    expect(hygiene.duration_ms).toBeLessThan(100);
  });

  it("names what is thrown when it is not an Error", async () => {
    const thrower: Layer = {
      ...fakeLayer({ id: "hygiene" }),
      run: () => Promise.reject(new Error("plain")),
    };
    const report = await setup().run([thrower]);
    expect(entry(report, "hygiene").reason).toBe("layer threw: plain");
  });
});

describe("the time a layer took", () => {
  it("is what the clock advanced while it ran", async () => {
    const report = await setup().run([fakeLayer({ id: "hygiene" })]);
    const took = entry(report, "hygiene").duration_ms;
    expect(took).toBeGreaterThan(0);
    expect(took).toBeLessThan(100);
  });
});

describe("a missing input names the layer that should have produced it", () => {
  it("is the producer's own verdict, not the first layer's", async () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1 }),
      fakeLayer({ id: "tests", gate: 2, verdict: "fail", reason: "a test failed" }),
      fakeLayer({
        id: "coverage",
        gate: 3,
        requires: ["tests"],
        consumes: [{ artifact: "coverage-json", from: "tests" }],
      }),
    ];
    const report = await setup().run(layers, cfg(), opts({ keepGoing: true }));
    expect(entry(report, "coverage").reason).toBe("input coverage-json missing: tests fail");
  });
});

/** A layer that records the inputs the runner showed it. */
function watching(seen: string[][], consumes: Layer["consumes"]): Layer {
  return {
    ...fakeLayer({ id: "coverage", gate: 3, requires: ["hygiene"], consumes }),
    run: (ctx: LayerContext) => {
      seen.push([...ctx.artifacts.keys()]);
      return Promise.resolve({ verdict: "pass", findings: [], artifacts: {} });
    },
  };
}

describe("R92 an optional input", () => {
  const optional = [{ artifact: "audit-json", from: "hygiene", optional: true }];

  it("is passed when the producer left it, and the layer runs without it when not", async () => {
    const seen: string[][] = [];
    const home = setup();
    const left = fakeLayer({
      id: "hygiene",
      artifacts: { "audit-json": home.write("hygiene/audit-json.json") },
    });
    const withIt = await home.run([left, watching(seen, optional)]);
    expect(entry(withIt, "coverage").verdict).toBe("pass");
    const without = await setup().run([fakeLayer({ id: "hygiene" }), watching(seen, optional)]);
    expect(entry(without, "coverage").verdict).toBe("pass");
    expect(seen).toEqual([["audit-json"], []]);
  });

  it("is not a missing input, while a required one beside it still is", async () => {
    const seen: string[][] = [];
    const both = [...optional, { artifact: "tsc-diagnostics", from: "hygiene" }];
    const report = await setup().run([fakeLayer({ id: "hygiene" }), watching(seen, both)]);
    expect(entry(report, "coverage")).toMatchObject({
      verdict: "not-run",
      reason: "input tsc-diagnostics missing: hygiene pass",
    });
    expect(seen).toEqual([]);
  });
});

describe("after a stop, the laws layer judges only when every layer it requires has run", () => {
  it("is not run when one of them was stopped before it ran", async () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1, verdict: "fail", reason: "lint failed" }),
      fakeLayer({ id: "coverage", gate: 3 }),
      fakeLayer({ id: "laws", gate: "laws", requires: ["hygiene", "coverage"] }),
    ];
    const report = await setup().run(layers);
    expect(entry(report, "laws")).toMatchObject({
      verdict: "not-run",
      reason: "stopped: gate 1 failed",
    });
  });

  it("judges when the one it requires has run, whatever its verdict", async () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1, verdict: "fail", reason: "lint failed" }),
      fakeLayer({ id: "coverage", gate: 3 }),
      fakeLayer({ id: "laws", gate: "laws", requires: ["hygiene"] }),
    ];
    const report = await setup().run(layers);
    expect(entry(report, "laws").verdict).toBe("pass");
    expect(entry(report, "coverage").verdict).toBe("not-run");
  });
});

describe("a run that stopped on a failing gate", () => {
  it("fails with no problem listed: the layers it never reached are named by their own entries", async () => {
    const layers = [
      fakeLayer({ id: "hygiene", gate: 1, verdict: "fail", reason: "lint failed" }),
      fakeLayer({ id: "tests", gate: 2 }),
    ];
    const report = await setup().run(layers);
    expect(report.problems).toEqual([]);
    expect(report.passed).toBe(false);
    expect(entry(report, "tests").verdict).toBe("not-run");
  });
});

describe("the CRAP scope the report names", () => {
  const all = cfg({ crap: { cap: 4, scope: "all", nullishDiscount: true } });

  it("is diff by default, and all from the config or --all", async () => {
    const layers = [fakeLayer({ id: "hygiene" })];
    expect((await setup().run(layers)).crap_scope).toBe("diff");
    expect((await setup().run(layers, all)).crap_scope).toBe("all");
    expect((await setup().run(layers, cfg(), opts({ all: true }))).crap_scope).toBe("all");
  });
});

describe("the text of a file a finding points at", () => {
  it("is read once however many findings point into it, and by file", () => {
    const reads: string[] = [];
    const read = sourceReader("/work", (cwd, file) => {
      reads.push(`${cwd}:${file}`);
      return file === "a.ts" ? "text" : undefined;
    });
    expect([read("a.ts"), read("a.ts"), read("b.ts"), read("b.ts"), read("a.ts")]).toEqual([
      "text",
      "text",
      undefined,
      undefined,
      "text",
    ]);
    expect(reads).toEqual(["/work:a.ts", "/work:b.ts"]);
  });
});

describe("the diff engine's options for a layer", () => {
  const base = { cwd: "/work", base: "main", exclude: ["src/gen/**"] };

  it("are kept for a layer that needs the tests' functions", () => {
    expect(optionsFor({ coveredByTests: true }, base)).toBe(base);
  });

  it("add a coverage of none for one that does not, and keep the rest", async () => {
    const given = optionsFor({ coveredByTests: false }, base);
    expect(given).toMatchObject(base);
    const covered = await given.coverageOf?.("src/a.test.ts");
    expect(covered).toBeInstanceOf(Map);
    expect(covered?.size).toBe(0);
  });
});

describe("the line a finding is anchored on", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A project beside a file that is not in it; a finding names `file`, on its second line. */
  async function anchoredOn(file: string): Promise<{ fingerprint: string; message: string }> {
    const parent = mkdtempSync(join(tmpdir(), "wt-anchor-"));
    made.push(parent);
    const dir = join(parent, "project");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "first\n  the line in the project  \n");
    writeFileSync(join(parent, "secret.txt"), "first\nthe line outside the project\n");
    const message = "what the tool said";
    const layer = fakeLayer({
      id: "hygiene",
      findings: [{ tool: "eslint", rule: "r", verdict: "pass", message, file, line: 2 }],
    });
    const report = await runGate({
      layers: [layer],
      config: cfg(),
      options: opts(),
      cwd: dir,
      env: {},
      exec: noExec,
      outDir: join(dir, ".web-tops", "out"),
      now: tickingClock(),
    });
    const found = entry(report, "hygiene").findings[0];
    return { fingerprint: found?.fingerprint ?? "", message };
  }

  const keyed = (file: string, anchor: string): string =>
    fingerprint({ tool: "eslint", rule: "r", file, anchor, occurrence: 1 });

  it("is the line of a file in the project", async () => {
    const found = await anchoredOn("src/a.ts");
    expect(found.fingerprint).toBe(keyed("src/a.ts", anchorOf("the line in the project")));
  });

  it("is the message when the file is outside the project: it is not read", async () => {
    const found = await anchoredOn("../secret.txt");
    expect(found.fingerprint).toBe(keyed("../secret.txt", anchorOf(found.message)));
  });
});
