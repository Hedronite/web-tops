import { describe, expect, it } from "vitest";
import { validateReport } from "../config/report.ts";
import type { RawFinding, Report } from "../report/types.ts";
import { buildRegistry } from "./registry.ts";
import { runGate } from "./runner.ts";
import { cfg, fakeBuiltins, fakeLayer, noExec, off, opts, tickingClock } from "./testkit.ts";
import type { Layer } from "./types.ts";

/** G4d: the runner writes the laws block, counted from the laws layer's findings. */

function run(layers: readonly Layer[], config = cfg()): Promise<Report> {
  return runGate({
    layers,
    config,
    options: opts(),
    cwd: "/unused",
    env: {},
    exec: noExec,
    outDir: "/unused/.web-tops/out",
    now: tickingClock(),
  });
}

const law = (id: string, verdict: RawFinding["verdict"], required = true): RawFinding => ({
  tool: "webtops",
  rule: `law/${id}`,
  law: id,
  verdict,
  message: `${id} ${verdict}`,
  required,
});

/** The built-in layers, with a laws layer that says the given findings. */
function withLaws(findings: readonly RawFinding[]): Layer[] {
  const others = fakeBuiltins([]).filter((layer) => layer.id !== "laws");
  return [...others, fakeLayer({ id: "laws", gate: "laws", requires: ["hygiene"], findings })];
}

describe("G4d the report counts N of M laws judged for the class", () => {
  it("counts the required laws the laws layer found, those judged, refused and not evaluated", async () => {
    const report = await run(
      withLaws([
        law("W-01", "pass"),
        law("W-02", "refuse"),
        law("W-16", "not-evaluated"),
        law("W-03", "not-evaluated", false),
      ]),
    );
    expect(report.laws).toEqual({
      class: "ts-library",
      of: 3,
      judged: 2,
      refused: 1,
      not_evaluated: 1,
    });
    expect(validateReport(report).ok).toBe(true);
  });

  it("says nothing of laws when the laws layer did not run: a skipped layer has no count", async () => {
    const config = cfg({ toggles: { laws: off("not yet") } });
    const report = await run(fakeBuiltins([]), config);
    expect(report.laws).toBeUndefined();
  });

  it("uses the class of the run", async () => {
    const report = await run(withLaws([law("W-01", "pass")]), cfg({ class: "node-service" }));
    expect(report.laws).toMatchObject({ class: "node-service", of: 1, judged: 1 });
  });
});

describe("G4a the registry holds the real laws layer", () => {
  it("is the laws layer over the law catalog, and not the stub", () => {
    const laws = buildRegistry(cfg()).find((layer) => layer.id === "laws");
    expect(laws?.consumes.slice(0, 2)).toEqual([
      { artifact: "eslint-json", from: "hygiene" },
      { artifact: "tsc-diagnostics", from: "hygiene" },
    ]);
  });

  it("with gate 1 off there is no ESLint JSON to read: the laws layer is not-run, naming the input", async () => {
    const config = cfg({
      toggles: {
        hygiene: off("t"),
        tests: off("t"),
        coverage: off("t"),
        crap: off("t"),
        mutation: off("t"),
        "build-output": off("t"),
      },
    });
    const report = await run(buildRegistry(config), config);
    const laws = report.layers.find((layer) => layer.id === "laws");
    expect(laws).toMatchObject({
      verdict: "not-run",
      reason: "input eslint-json missing: hygiene skip",
    });
    expect(report.laws).toBeUndefined();
  });
});
