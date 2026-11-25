import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTypeScript } from "../../complexity/index.ts";
import type { DiffProvider, GateConfig, LayerContext } from "../../gate/types.ts";
import {
  fromDiff,
  judgeReport,
  judgeShard,
  overBudget,
  readReport,
  shardPlan,
  vacuousDiff,
  vacuousResult,
} from "./index.ts";
import {
  readPartial,
  timedOutPartial,
  vacuousPartial,
  writePartial,
  zeroCounts,
  type ShardMeta,
} from "./partial.ts";
import type { MutationRead, SurvivorRow } from "./read.ts";
import { keyString } from "../../survivors/key.ts";
import { hashEntries } from "./shard.ts";

const ts = loadTypeScript(resolve(import.meta.dirname, "../../.."));
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const BASE_CONFIG: GateConfig = {
  protocol: "0.3.0",
  package: "pkg",
  class: "ts-library",
  enforce: "hard",
  reportPath: ".web-tops/report.json",
  toggles: {},
  custom: [],
  optionalLayers: [],
  hygiene: { steps: {}, auditFailOn: "high" },
  tests: { shuffle: false },
  coverage: { linesFloor: 85, exclude: [] },
  crap: { cap: 4, scope: "diff", nullishDiscount: true },
  mutation: { scope: "diff", maxSurvivors: 0, timeBudgetMinutes: 30 },
};

function makeCtx(dir: string, shard?: { index: number; count: number }): LayerContext {
  return {
    cwd: dir,
    config: BASE_CONFIG,
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    outDir: join(dir, ".web-tops", "out"),
    artifacts: new Map(),
    ...(shard === undefined ? {} : { shard }),
  };
}

const META: ShardMeta = {
  shard: 1,
  shards: 2,
  base: "abc1234",
  entriesHash: hashEntries(["src/a.ts:1-10"]),
  entriesCount: 1,
  shardEntries: ["src/a.ts:1-10"],
};

describe("partial mutation artifact builders", () => {
  it("builds vacuous, timedOut, and read partial payloads and writes partial.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-partial-io-"));
    dirs.push(dir);
    expect(vacuousPartial(META)).toEqual({
      version: 1,
      ...META,
      counts: zeroCounts(),
      survivors: [],
      excluded: 0,
      unknown: [],
      timedOut: false,
      starved: false,
      vacuous: true,
    });
    expect(timedOutPartial(META)).toEqual({
      version: 1,
      ...META,
      counts: zeroCounts(),
      survivors: [],
      excluded: 0,
      unknown: [],
      timedOut: true,
      starved: false,
      vacuous: false,
    });
    const read: MutationRead = {
      killed: 3,
      excluded: 1,
      survivors: [
        {
          status: "Survived",
          file: "src/a.ts",
          line: 2,
          key: {
            file: "src/a.ts",
            function: "src/a.ts::f",
            mutator: "ArithmeticOperator",
            original: "+",
            replacement: "-",
            occurrence: 1,
          },
        },
      ],
      unknown: [],
      counts: {
        killed: 3,
        timeout: 0,
        survived: 1,
        no_coverage: 0,
        runtime_error: 0,
        compile_error: 1,
        ignored: 0,
      },
    };
    const outPath = writePartial(
      join(dir, ".web-tops", "out"),
      readPartial(META, read, false, false),
    );
    expect(outPath.endsWith("/mutation/partial.json")).toBe(true);
    expect(readJson(outPath)).toEqual({
      version: 1,
      ...META,
      counts: read.counts,
      survivors: read.survivors,
      excluded: 1,
      unknown: [],
      timedOut: false,
      starved: false,
      vacuous: false,
    });
  });
});

describe("fromDiff, shardPlan, vacuousDiff, vacuousResult, overBudget, readShardReport, and judgeShard", () => {
  it("handles vacuous, failing, and scoped diffs while keeping entriesHash and metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-vac-shard-"));
    dirs.push(dir);
    const ctx = makeCtx(dir, { index: 2, count: 2 });

    expect(vacuousDiff(undefined, "no changes", "sha0")).toEqual({
      stop: { verdict: "vacuous", reason: "no changes", findings: [], artifacts: {} },
    });
    expect(vacuousDiff({ index: 2, count: 2 }, "no changes", "sha0")).toEqual({
      entries: [],
      base: "sha0",
      vacuousReason: "no changes",
    });

    const vacProvider: DiffProvider = () =>
      Promise.resolve({
        outcome: "vacuous",
        reason: "docs only",
        scope: {
          mergeBase: "sha-vac",
          files: [],
          changedFunctions: [],
          testFiles: [],
          coveredFunctions: [],
          mutate: [],
        },
      });
    expect(await fromDiff(ctx, vacProvider, () => [])).toEqual({
      entries: [],
      base: "sha-vac",
      vacuousReason: "docs only",
    });

    const failProvider: DiffProvider = () =>
      Promise.resolve({ outcome: "fail", reason: "no merge base" });
    const failedDiff = await fromDiff(ctx, failProvider, () => []);
    expect("stop" in failedDiff && failedDiff.stop.verdict).toBe("fail");

    const scopeProvider: DiffProvider = () =>
      Promise.resolve({
        outcome: "scope",
        scope: {
          mergeBase: "sha-scope",
          files: [],
          changedFunctions: [],
          testFiles: [],
          coveredFunctions: [],
          mutate: ["src/a.ts:1-5"],
        },
      });
    expect(await fromDiff(ctx, scopeProvider, (entries) => [...entries])).toEqual({
      entries: ["src/a.ts:1-5"],
      base: "sha-scope",
    });

    const noShardPlan = shardPlan(makeCtx(dir), { entries: ["src/a.ts:1-5"], base: "sha1" });
    expect(noShardPlan).toEqual({ entries: ["src/a.ts:1-5"] });

    const singlePlan = shardPlan(ctx, { entries: ["src/a.ts:1-5"], base: "sha1" });
    expect(singlePlan.entries).toEqual([]);
    expect(singlePlan.meta).toMatchObject({
      shard: 2,
      shards: 2,
      base: "sha1",
      entriesHash: hashEntries(["src/a.ts:1-5"]),
      entriesCount: 1,
      shardEntries: [],
    });

    const vacRes = vacuousResult(ctx, singlePlan.meta, "custom vacuous");
    expect(vacRes).toEqual({
      verdict: "vacuous",
      reason: "custom vacuous",
      findings: [],
      artifacts: {},
    });
    expect(readJson(join(dir, ".web-tops/out/mutation/partial.json"))).toMatchObject({
      shard: 2,
      shards: 2,
      base: "sha1",
      entriesHash: hashEntries(["src/a.ts:1-5"]),
      vacuous: true,
      timedOut: false,
      starved: false,
    });

    const defaultVac = vacuousResult(makeCtx(dir), undefined, undefined);
    expect(defaultVac.verdict).toBe("vacuous");
    expect(defaultVac.reason).toContain("no source file");
  });

  it("writes timedOut partial.json on overBudget and handles missing/unparseable/valid shard reports", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-budget-shard-"));
    dirs.push(dir);
    const ctx = makeCtx(dir, { index: 1, count: 2 });
    const res = overBudget(ctx, META);
    expect(res.verdict).toBe("not-evaluated");
    expect(res.reason).toContain("30 minutes");
    expect(readJson(join(dir, ".web-tops/out/mutation/partial.json"))).toMatchObject({
      shard: 1,
      shards: 2,
      base: "abc1234",
      timedOut: true,
      vacuous: false,
    });

    const missingPath = join(dir, "missing.json");
    const missing = readReport(ctx, ts, missingPath, META);
    expect(missing.verdict).toBe("fail");
    expect(missing.findings[0]).toMatchObject({
      rule: "output-empty",
      file: "missing.json",
      message: "missing.json was not written",
    });

    const relCtx = makeCtx(process.cwd(), { index: 1, count: 2 });
    const relMissing = readReport(relCtx, ts, "./rel-missing.json", META);
    expect(relMissing.findings[0]).toMatchObject({
      rule: "output-empty",
      file: "./rel-missing.json",
      message: "./rel-missing.json was not written",
    });

    const outsidePath = join(tmpdir(), "wt-outside-missing.json");
    const outsideMissing = readReport(ctx, ts, outsidePath, META);
    expect(outsideMissing.findings[0]).toMatchObject({
      rule: "output-empty",
      file: outsidePath,
    });

    const noFilesPath = join(dir, "nofiles.json");
    writeFileSync(noFilesPath, "{}");
    const noFilesErr = readReport(ctx, ts, noFilesPath, META);
    expect(noFilesErr.verdict).toBe("fail");
    expect(noFilesErr.findings[0]).toMatchObject({
      rule: "output-unparseable",
      file: "nofiles.json",
    });
    expect(noFilesErr.findings[0]?.message).toContain("it has no files");

    const badPath = join(dir, "bad.json");
    writeFileSync(badPath, "{not-json");
    const badErr = readReport(ctx, ts, badPath, META);
    expect(badErr.verdict).toBe("fail");
    expect(badErr.findings[0]).toMatchObject({
      rule: "output-unparseable",
      file: "bad.json",
    });

    const nonErr = readReport(ctx, ts, badPath, META, () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercise non-Error fallback
      throw "raw failure";
    });
    expect(nonErr.findings[0]?.message).toBe("the report could not be read");

    const emptyRead: MutationRead = {
      killed: 1,
      excluded: 0,
      survivors: [],
      unknown: [],
      counts: {
        killed: 1,
        timeout: 0,
        survived: 0,
        no_coverage: 0,
        runtime_error: 0,
        compile_error: 0,
        ignored: 0,
      },
    };
    const explainedRow: SurvivorRow = {
      status: "Survived",
      file: "src/a.ts",
      line: 1,
      key: {
        file: "src/a.ts",
        function: "src/a.ts::f",
        mutator: "ArithmeticOperator",
        original: "+",
        replacement: "-",
        occurrence: 1,
      },
    };
    const openRow: SurvivorRow = {
      ...explainedRow,
      line: 2,
      key: { ...explainedRow.key, occurrence: 2 },
    };
    const unshardedCtx: LayerContext = {
      ...makeCtx(dir),
      config: {
        ...BASE_CONFIG,
        mutation: { ...BASE_CONFIG.mutation, maxSurvivors: 2 },
      },
      explained: new Set([keyString(explainedRow.key)]),
    };
    const unshardedRead: MutationRead = {
      killed: 1,
      excluded: 0,
      survivors: [explainedRow, openRow],
      unknown: [],
      counts: {
        killed: 1,
        timeout: 0,
        survived: 2,
        no_coverage: 0,
        runtime_error: 0,
        compile_error: 0,
        ignored: 0,
      },
    };
    const unshardedRes = judgeReport(unshardedCtx, unshardedRead, undefined);
    expect(unshardedRes.verdict).toBe("pass");
    expect(unshardedRes.findings.at(-1)?.message).toContain(
      "1 unexplained survivors of 2 (1 explained), 0 excluded, at most 2 allowed",
    );
    expect(judgeReport(ctx, emptyRead, META).verdict).toBe("pass");
  });

  it("defers survivor judgment to join while preserving raw survivors, truncation, starvation, unknown, and vacuous", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-judge-shard-"));
    dirs.push(dir);
    const ctx = makeCtx(dir, { index: 1, count: 2 });
    const plan = shardPlan(ctx, { entries: ["src/a.ts:1-10", "src/b.ts:1-20"], base: "deadbeef" });
    const meta = plan.meta ?? META;
    const partialPath = join(dir, ".web-tops/out/mutation/partial.json");

    const row60: SurvivorRow = {
      status: "Survived",
      file: "src/a.ts",
      line: 1,
      key: {
        file: "src/a.ts",
        function: "src/a.ts::f",
        mutator: "StringLiteral",
        original: `short\n${"x".repeat(60)}`,
        replacement: "b".repeat(60),
        occurrence: 1,
      },
    };
    const row61: SurvivorRow = {
      status: "NoCoverage",
      file: "src/b.ts",
      line: 2,
      key: {
        file: "src/b.ts",
        function: "src/b.ts::g",
        mutator: "BlockStatement",
        original: "c".repeat(61),
        replacement: "{}",
        occurrence: 1,
      },
    };
    const withSurvivor: MutationRead = {
      killed: 10,
      excluded: 1,
      survivors: [row60, row61],
      unknown: [],
      counts: {
        killed: 10,
        timeout: 1,
        survived: 1,
        no_coverage: 1,
        runtime_error: 0,
        compile_error: 1,
        ignored: 0,
      },
    };
    const res = judgeShard(ctx, withSurvivor, meta);
    expect(res.verdict).toBe("pass");
    expect(res.metrics).toEqual({ mutation: withSurvivor.counts });
    expect(res.findings[0]).toMatchObject({
      rule: "survived",
      verdict: "pass",
      message: `StringLiteral \`short\` -> \`${"b".repeat(60)}\` survived: no test failed (src/a.ts::f)`,
    });
    expect(res.findings[1]).toMatchObject({
      rule: "no-coverage",
      verdict: "pass",
      message: `BlockStatement \`${"c".repeat(57)}...\` -> \`{}\` is not covered by any test (src/b.ts::g)`,
    });
    expect(res.findings[2]).toMatchObject({
      rule: "mutation",
      verdict: "pass",
      message:
        "pkg (shard 1/2): 10 mutants killed, 2 survivors (deferred to join), 1 excluded " +
        "(killed 10, timeout 1, survived 1, no-coverage 1, runtime-error 0, compile-error 1, ignored 0)",
    });
    expect(readJson(partialPath)).toMatchObject({
      survivors: withSurvivor.survivors,
      starved: false,
      vacuous: false,
      timedOut: false,
    });

    // Timeout threshold check: killed 10 + survivors 20 = 30 -> limit 3 -> timeout 3 is NOT starved,
    // whereas killed 10 - 20 = -10 would be < 3 and fail as starved (kills + -> - in judgedOf).
    const rows20 = Array.from({ length: 20 }, (_, i) => ({ ...row60, line: i + 1 }));
    const borderline: MutationRead = {
      killed: 10,
      excluded: 0,
      survivors: rows20,
      unknown: [],
      counts: {
        killed: 10,
        timeout: 3,
        survived: 20,
        no_coverage: 0,
        runtime_error: 0,
        compile_error: 0,
        ignored: 0,
      },
    };
    expect(judgeShard(ctx, borderline, meta).verdict).toBe("pass");

    const starvedRead: MutationRead = {
      killed: 1,
      excluded: 0,
      survivors: [],
      unknown: [],
      counts: {
        killed: 1,
        timeout: 3,
        survived: 0,
        no_coverage: 0,
        runtime_error: 0,
        compile_error: 0,
        ignored: 0,
      },
    };
    expect(judgeShard(ctx, starvedRead, meta).verdict).toBe("not-evaluated");
    expect(Reflect.get(Object(readJson(partialPath)), "starved")).toBe(true);

    const unknownRead: MutationRead = {
      killed: 1,
      excluded: 0,
      survivors: [],
      unknown: ["", "MysteryStatus"],
      counts: {
        killed: 1,
        timeout: 0,
        survived: 0,
        no_coverage: 0,
        runtime_error: 0,
        compile_error: 0,
        ignored: 0,
      },
    };
    const unkRes = judgeShard(ctx, unknownRead, meta);
    expect(unkRes.verdict).toBe("fail");
    expect(unkRes.findings[0]?.message).toContain("no status");
    expect(unkRes.findings[1]?.message).toContain("MysteryStatus");

    const emptyRead: MutationRead = {
      killed: 0,
      excluded: 2,
      survivors: [],
      unknown: [],
      counts: {
        killed: 0,
        timeout: 0,
        survived: 0,
        no_coverage: 0,
        runtime_error: 0,
        compile_error: 2,
        ignored: 0,
      },
    };
    expect(judgeShard(ctx, emptyRead, meta).verdict).toBe("vacuous");
    expect(Reflect.get(Object(readJson(partialPath)), "vacuous")).toBe(true);
  });
});
