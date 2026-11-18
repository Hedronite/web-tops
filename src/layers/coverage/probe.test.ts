import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, LayerContext } from "../../gate/types.ts";
import { at, get } from "../../config/test-support.ts";
import { coverageLayer } from "./index.ts";

/** G2b: the E3 and E4 probes of fixtures/probe, run through the coverage layer, give the outcome EXPECTED.yaml states. */

const probe = resolve(import.meta.dirname, "../../../fixtures/probe");
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tracked(...files: string[]): Exec {
  return () =>
    Promise.resolve({ code: 0, stdout: files.map((file) => `${file}\0`).join(""), stderr: "" });
}

/** The layer over a probe case: its own directory as the project, one of its recorded LCOVs as gate 2's output. */
function contextFor(id: string, lcov: string, files: readonly string[]): LayerContext {
  const dir = mkdtempSync(join(tmpdir(), "webtops-probe-"));
  scratch.push(dir);
  const setup = join(dir, "setup-files.json");
  writeFileSync(setup, "[]");
  return {
    cwd: resolve(probe, id),
    config: cfg(),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: tracked(...files),
    outDir: dir,
    artifacts: new Map([
      ["lcov", resolve(probe, id, "recorded", lcov)],
      ["setup-files", setup],
    ]),
  };
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function stated(id: string): unknown {
  const expected: unknown = parse(readFileSync(resolve(probe, "EXPECTED.yaml"), "utf8"));
  const cases = get(expected, "cases");
  return Array.isArray(cases) ? cases.find((item) => get(item, "id") === id) : undefined;
}

describe("G2b E4: a source file no test imports", () => {
  const id = "e4-unimported-file";
  const files = ["src/used.ts", "src/used.test.ts", "src/unimported.ts"];

  it("fails on the profile the gate would otherwise have judged, naming the file EXPECTED.yaml names", async () => {
    const result = await coverageLayer.run(contextFor(id, "lcov-without-include.info", files));
    expect(result.verdict).toBe(at(stated(id), ["outcome", "verdicts", "coverage"]));
    const finding = result.findings.find((item) => item.rule === "no-coverage-record");
    const expectedFinding = first(at(stated(id), ["outcome", "findings"]));
    expect(finding).toMatchObject({ file: get(expectedFinding, "file"), verdict: "fail" });
    expect(finding?.message).toContain("no test imports it");
    expect(result.findings.filter((item) => item.rule === "no-coverage-record")).toHaveLength(1);
  });

  it("fails on the profile the gate does judge, where the file reads 0 % and drags the total under the floor", async () => {
    const result = await coverageLayer.run(contextFor(id, "lcov.info", files));
    expect(result.verdict).toBe("fail");
    expect(result.findings.map((item) => item.rule)).toContain("coverage-below-floor");
    expect(result.metrics?.coverage).toContainEqual({
      file: "src/unimported.ts",
      lines_found: 3,
      lines_hit: 0,
    });
  });
});

describe("G2b E3: a v8 ignore hint over an untested throw", () => {
  const id = "e3-v8-ignore";

  it("stays pass, as EXPECTED.yaml says, and reports the hint with its file and line", async () => {
    const result = await coverageLayer.run(
      contextFor(id, "lcov.info", ["src/guard.ts", "src/guard.test.ts"]),
    );
    expect(result.verdict).toBe(at(stated(id), ["outcome", "verdicts", "coverage"]));
    const hints = result.findings.filter((item) => item.rule === "coverage-hint");
    expect(hints).toMatchObject([
      { tool: "webtops", verdict: "pass", file: "src/guard.ts", line: 2 },
    ]);
  });
});
