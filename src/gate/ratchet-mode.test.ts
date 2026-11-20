import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Baseline } from "../baseline/types.ts";
import { runGate } from "./runner.ts";
import { cfg, fakeLayer, noExec, opts, tickingClock } from "./testkit.ts";

/** Only the ratchet mode reads the baseline a config names. */

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BASELINE = ".web-tops/baseline.json";

const BASE: Baseline = {
  report_version: "2.0.0",
  subject: { package: "fixture", root: "." },
  crap: { "src/a.ts::f": { complexity: 3, coverage: 1, crap: 3 } },
  coverage: {},
  findings: {},
  fingerprints: [],
  census: {},
  pages: {},
};

function above(enforce: "hard"): ReturnType<typeof runGate> {
  const dir = mkdtempSync(join(tmpdir(), "wt-ratchet-mode-"));
  made.push(dir);
  mkdirSync(join(dir, ".web-tops"));
  writeFileSync(join(dir, BASELINE), JSON.stringify(BASE));
  const crap = fakeLayer({
    id: "crap",
    gate: 4,
    metrics: {
      crap: [{ file: "src/a.ts", name: "f", line: 1, complexity: 3, coverage: 1, crap: 9 }],
    },
  });
  return runGate({
    layers: [crap],
    config: cfg({ enforce, baselinePath: BASELINE }),
    options: opts(),
    cwd: dir,
    env: {},
    exec: noExec,
    outDir: join(dir, ".web-tops", "out"),
    now: tickingClock(),
  });
}

describe("G9b: a run above its baseline", () => {
  it("is left alone under hard, though the config names a baseline", async () => {
    const hard = await above("hard");
    expect(hard.layers[0]?.verdict).toBe("pass");
    expect(hard.layers[0]?.findings).toEqual([]);
    expect(hard.passed).toBe(true);
  });
});
