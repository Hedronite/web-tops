import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { keyString } from "../survivors/key.ts";
import { CLAMP_KEY, entryYaml, ledgerYaml } from "../survivors/test-support.ts";
import type { Report } from "../report/types.ts";
import { runGate } from "./runner.ts";
import { cfg, fakeLayer, noExec, opts } from "./testkit.ts";
import type { GateConfig, Layer, LayerContext, LayerResult } from "./types.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-11-17T12:00:00Z");
const LEDGER = ".web-tops/survivors.yaml";

interface Seen {
  mutation: ReadonlySet<string> | undefined | "not-run";
  other: ReadonlySet<string> | undefined | "not-run";
}

/** The mutation layer and one other, each recording the `explained` set its context carried. */
function layers(seen: Seen, verdict: LayerResult["verdict"] = "pass"): Layer[] {
  const recording = (
    id: string,
    gate: 2 | 5,
    key: keyof Seen,
    result: LayerResult["verdict"],
  ): Layer => ({
    ...fakeLayer({ id, gate, tier: 1 }),
    run: (ctx: LayerContext): Promise<LayerResult> => {
      seen[key] = ctx.explained;
      return Promise.resolve({ verdict: result, findings: [], artifacts: {} });
    },
  });
  return [recording("tests", 2, "other", "pass"), recording("mutation", 5, "mutation", verdict)];
}

function run(
  dir: string,
  seen: Seen,
  config: GateConfig = cfg(),
  verdict: LayerResult["verdict"] = "pass",
): Promise<Report> {
  return runGate({
    layers: layers(seen, verdict),
    config,
    options: opts(),
    cwd: dir,
    env: {},
    exec: noExec,
    outDir: `${dir}/.web-tops/out`,
    now: () => NOW,
  });
}

const fresh = (): Seen => ({ mutation: "not-run", other: "not-run" });

const projectWith = (...entries: readonly string[]): string => {
  const dir = tempDir();
  put(dir, LEDGER, ledgerYaml(...entries));
  return dir;
};

const layerOf = (report: Report, id: string) => report.layers.find((entry) => entry.id === id);

describe("G8 the gate hands the mutation layer the ledger's explained keys", () => {
  it("gives the mutation layer the key strings of the live entries, and no other layer anything", async () => {
    const seen = fresh();
    const dir = projectWith(entryYaml(CLAMP_KEY, ["reason: r", "owner: o"]));
    const report = await run(dir, seen);
    expect(seen.mutation).toEqual(new Set([keyString(CLAMP_KEY)]));
    expect(seen.other).toBeUndefined();
    expect(report.passed).toBe(true);
    expect(layerOf(report, "mutation")?.verdict).toBe("pass");
  });

  it("gives an empty set, and passes, when there is no ledger", async () => {
    const seen = fresh();
    const report = await run(tempDir(), seen);
    expect(seen.mutation).toEqual(new Set());
    expect(layerOf(report, "mutation")?.verdict).toBe("pass");
  });

  it("reads the ledger the config names", async () => {
    const seen = fresh();
    const dir = tempDir();
    put(dir, "accepted.yaml", ledgerYaml(entryYaml(CLAMP_KEY, ["reason: r", "owner: o"])));
    await run(
      dir,
      seen,
      cfg({
        mutation: {
          scope: "diff",
          maxSurvivors: 0,
          timeBudgetMinutes: 30,
          ledger: "accepted.yaml",
        },
      }),
    );
    expect(seen.mutation).toEqual(new Set([keyString(CLAMP_KEY)]));
  });
});

describe("G8 an expired entry fails the mutation layer, and the run", () => {
  const expired = ["reason: r", "owner: web-platform", "expires: 2026-11-16"];

  it("turns a passing layer into a failure, with a finding that names the entry", async () => {
    const seen = fresh();
    const report = await run(projectWith(entryYaml(CLAMP_KEY, expired)), seen);
    expect(layerOf(report, "mutation")).toMatchObject({ verdict: "fail" });
    expect(report).toMatchObject({ passed: false, exit_code: 1 });
    const finding = layerOf(report, "mutation")?.findings.find(
      (item) => item.rule === "ledger-expired",
    );
    expect(finding).toMatchObject({ verdict: "fail", file: LEDGER });
    expect(finding?.message).toContain("web-platform");
    expect(seen.mutation).toEqual(new Set());
  });

  it.each([["vacuous"], ["not-evaluated"]] as const)(
    "fails even when the layer's own verdict is %s",
    async (verdict) => {
      const report = await run(projectWith(entryYaml(CLAMP_KEY, expired)), fresh(), cfg(), verdict);
      expect(layerOf(report, "mutation")?.verdict).toBe("fail");
    },
  );

  it("is quiet on the day the entry names", async () => {
    const dir = projectWith(entryYaml(CLAMP_KEY, ["reason: r", "owner: o", "expires: 2026-11-17"]));
    expect(layerOf(await run(dir, fresh()), "mutation")?.verdict).toBe("pass");
  });
});

describe("G8 a ledger that is not valid fails the mutation layer", () => {
  it("says what is wrong at its pointer", async () => {
    const report = await run(projectWith(entryYaml(CLAMP_KEY, ["owner: o"])), fresh());
    const layer = layerOf(report, "mutation");
    expect(layer?.verdict).toBe("fail");
    const finding = layer?.findings.find((item) => item.rule === "ledger-invalid");
    expect(finding?.message).toBe("/survivors/0/reason: reason is missing");
  });

  it("keeps the layer's own failure, and adds the ledger's findings to it", async () => {
    const report = await run(
      projectWith(entryYaml(CLAMP_KEY, ["owner: o"])),
      fresh(),
      cfg(),
      "fail",
    );
    expect(layerOf(report, "mutation")?.verdict).toBe("fail");
    expect(layerOf(report, "mutation")?.findings.map((item) => item.rule)).toContain(
      "ledger-invalid",
    );
  });
});
