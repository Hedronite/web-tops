import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GateConfig, LayerContext } from "../../gate/types.ts";
import { keyString } from "../../survivors/key.ts";
import { judgeJoined } from "./index.ts";
import { isRecord, loadJoined } from "./join.ts";
import type { PartialMutation } from "./partial.ts";
import type { SurvivorRow } from "./read.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

function makeCtx(dir: string, maxSurvivors = 0, explained?: ReadonlySet<string>): LayerContext {
  return {
    cwd: dir,
    config: { ...BASE_CONFIG, mutation: { ...BASE_CONFIG.mutation, maxSurvivors } },
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    outDir: join(dir, ".web-tops", "out"),
    artifacts: new Map(),
    ...(explained === undefined ? {} : { explained }),
  };
}

function makePartial(over: Partial<PartialMutation> = {}): PartialMutation {
  return {
    version: 1,
    shard: 1,
    shards: 2,
    base: "base-sha",
    entriesHash: "hash-abc",
    entriesCount: 2,
    shardEntries: ["src/a.ts:1-5"],
    counts: {
      killed: 2,
      timeout: 0,
      survived: 0,
      no_coverage: 0,
      runtime_error: 0,
      compile_error: 1,
      ignored: 0,
    },
    survivors: [],
    excluded: 1,
    unknown: [],
    timedOut: false,
    starved: false,
    vacuous: false,
    ...over,
  };
}

function survivor(
  fn: string,
  mutator = "ArithmeticOperator",
  occurrence = 1,
  line = 2,
): SurvivorRow {
  return {
    status: "Survived",
    file: "src/a.ts",
    line,
    key: {
      file: "src/a.ts",
      function: fn,
      mutator,
      original: "+",
      replacement: "-",
      occurrence,
    },
  };
}

function dirWith(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-join-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

const findingOf = (res: ReturnType<typeof loadJoined>) =>
  "finding" in res ? res.finding : undefined;

describe("loadJoined fails closed on missing, corrupt, duplicate, or mismatched shards", () => {
  it("fails on missing path, non-directory file, empty dir, corrupt JSON, and invalid schema", () => {
    const missing = loadJoined("/nonexistent/wt-join-path");
    expect(findingOf(missing)).toMatchObject({
      rule: "join-missing",
      message: "/nonexistent/wt-join-path could not be read",
    });

    const filePath = join(dirWith({ "only.txt": "hi" }), "only.txt");
    const notDir = loadJoined(filePath);
    expect(findingOf(notDir)).toMatchObject({
      rule: "join-missing",
      message: `${filePath} is not a directory`,
    });

    const emptyDir = dirWith({ "notes.txt": "ignored" });
    const empty = loadJoined(emptyDir);
    expect(findingOf(empty)).toMatchObject({
      rule: "join-empty",
      message: `no partial mutation artifacts found in ${emptyDir}`,
    });

    expect(isRecord(42)).toBe(false);
    expect(isRecord("str")).toBe(false);
    expect(isRecord({})).toBe(true);

    // "a-1/z.json" sorts before "a/a.json" (- < /) even when readdir visits "a" before "a-1"
    const sortedDir = dirWith({ "a/a.json": { version: 2 }, "a-1/z.json": "{not-json" });
    const badJson = loadJoined(sortedDir);
    expect(findingOf(badJson)).toMatchObject({
      rule: "join-unparseable",
      file: join(sortedDir, "a-1/z.json"),
      message: `${join(sortedDir, "a-1/z.json")} is not valid JSON`,
    });

    const validKey = survivor("src/a.ts::f").key;
    for (const invalid of [
      null,
      [],
      42,
      { ...makePartial(), version: 2 },
      { ...makePartial(), shard: 0, shards: 2 },
      { ...makePartial(), shard: "1", shards: 2 },
      { ...makePartial(), shard: 3, shards: 2 },
      { ...makePartial(), base: 123 },
      { ...makePartial(), base: "" },
      { ...makePartial(), entriesHash: "" },
      { ...makePartial(), counts: "not-object" },
      { ...makePartial(), counts: { killed: -1 } },
      { ...makePartial(), counts: { ...makePartial().counts, ignored: -1 } },
      { ...makePartial(), excluded: -1 },
      { ...makePartial(), survivors: [{ line: 1, key: validKey }] },
      { ...makePartial(), survivors: [{ status: "Survived", file: "a", line: 0, key: validKey }] },
      { ...makePartial(), survivors: [{ status: "Survived", file: "a", line: 1, key: null }] },
      { ...makePartial(), survivors: [{ status: "Survived", file: "a", line: 1, key: [] }] },
      { ...makePartial(), survivors: [{ status: "Survived", file: "a", line: 1, key: "str" }] },
      {
        ...makePartial(),
        survivors: [{ status: "Survived", file: "a", line: 1, key: { occurrence: 1 } }],
      },
      {
        ...makePartial(),
        survivors: [{ status: "Survived", file: "a", line: 1, key: { ...validKey, file: 99 } }],
      },
      { ...makePartial(), unknown: [123] },
      { ...makePartial(), timedOut: "no" },
    ]) {
      const badDir = dirWith({ "bad.json": invalid });
      const res = loadJoined(badDir);
      expect(findingOf(res)).toMatchObject({
        rule: "join-invalid",
        file: join(badDir, "bad.json"),
        message: `${join(badDir, "bad.json")} is not a valid partial mutation artifact`,
      });
    }
  });

  it("fails on mismatched shards count, base, entriesHash, duplicate shard, and missing shard index", () => {
    const diffCount = loadJoined(
      dirWith({
        "a.json": makePartial({ shard: 1, shards: 2 }),
        "b.json": makePartial({ shard: 2, shards: 3 }),
      }),
    );
    expect(findingOf(diffCount)).toMatchObject({
      rule: "join-mismatch",
      message: "shard 2/3 disagrees with shard count 2",
    });

    const diffBase = loadJoined(
      dirWith({
        "a.json": makePartial({ shard: 1, base: "a" }),
        "b.json": makePartial({ shard: 2, base: "b" }),
      }),
    );
    expect(findingOf(diffBase)).toMatchObject({
      rule: "join-mismatch",
      message: "shard 2/2 has base b, expected a",
    });

    const diffHash = loadJoined(
      dirWith({
        "a.json": makePartial({ shard: 1, entriesHash: "h1" }),
        "b.json": makePartial({ shard: 2, entriesHash: "h2" }),
      }),
    );

    const thirdMismatch = loadJoined(
      dirWith({
        "a.json": makePartial({ shard: 1, shards: 3, base: "ok" }),
        "b.json": makePartial({ shard: 2, shards: 3, base: "ok" }),
        "c.json": makePartial({ shard: 3, shards: 3, base: "bad" }),
      }),
    );
    expect(findingOf(thirdMismatch)).toMatchObject({
      rule: "join-mismatch",
      message: "shard 3/3 has base bad, expected ok",
    });
    expect(findingOf(diffHash)).toMatchObject({
      rule: "join-mismatch",
      message: "shard 2/2 has mismatched entriesHash",
    });

    const dup = loadJoined(
      dirWith({ "a.json": makePartial({ shard: 1 }), "b.json": makePartial({ shard: 1 }) }),
    );
    expect(findingOf(dup)).toMatchObject({
      rule: "join-duplicate",
      message: "duplicate shard 1/2",
    });

    const gap = loadJoined(
      dirWith({
        "s1/partial.json": makePartial({ shard: 1, shards: 2 }),
      }),
    );
    expect(findingOf(gap)).toMatchObject({
      rule: "join-missing-shard",
      message: "missing shard 2/2",
    });
  });
});

describe("loadJoined and judgeJoined unify counts, survivors, starvation, and timeouts", () => {
  it("sums all 7 counts across nested dirs in shard order, unions survivors, and judges once with ledger", () => {
    const s1FromShard1 = survivor("src/a.ts::f", "ArithmeticOperator", 1, 2);
    const s1FromShard2 = survivor("src/a.ts::f", "ArithmeticOperator", 1, 99);
    const s2 = survivor("src/b.ts::g", "BlockStatement", 1, 5);
    const dir = dirWith({
      "a-shard-2/partial.json": makePartial({
        shard: 2,
        counts: {
          killed: 3,
          timeout: 1,
          survived: 2,
          no_coverage: 1,
          runtime_error: 2,
          compile_error: 0,
          ignored: 3,
        },
        survivors: [s1FromShard2, s2],
        excluded: 5,
        unknown: ["CustomStatus"],
      }),
      "z-shard-1/partial.json": makePartial({
        shard: 1,
        counts: {
          killed: 2,
          timeout: 0,
          survived: 1,
          no_coverage: 2,
          runtime_error: 1,
          compile_error: 1,
          ignored: 4,
        },
        survivors: [s1FromShard1],
        excluded: 6,
      }),
    });
    const joined = loadJoined(dir);
    expect("read" in joined).toBe(true);
    if (!("read" in joined)) return;
    expect(joined.shardStarved).toBe(false);
    expect(joined.starvedReason).toBe("");
    expect(joined.read.killed).toBe(6);
    expect(joined.read.counts).toEqual({
      killed: 5,
      timeout: 1,
      survived: 3,
      no_coverage: 3,
      runtime_error: 3,
      compile_error: 1,
      ignored: 7,
    });
    expect(joined.read.survivors).toHaveLength(2);
    expect(joined.read.survivors[0]?.line).toBe(2);
    expect(joined.read.excluded).toBe(11);
    expect(joined.read.unknown).toEqual(["CustomStatus"]);

    expect(judgeJoined(makeCtx(dir, 10), joined).verdict).toBe("fail");

    const cleanDir = dirWith({
      "a.json": makePartial({
        shard: 2,
        counts: {
          killed: 3,
          timeout: 1,
          survived: 1,
          no_coverage: 0,
          runtime_error: 0,
          compile_error: 0,
          ignored: 0,
        },
        survivors: [s1FromShard1, s2],
        excluded: 0,
      }),
      "b.json": makePartial({
        shard: 1,
        counts: {
          killed: 2,
          timeout: 0,
          survived: 1,
          no_coverage: 0,
          runtime_error: 0,
          compile_error: 1,
          ignored: 0,
        },
        survivors: [s1FromShard1],
        excluded: 1,
      }),
    });
    const cleanJoined = loadJoined(cleanDir);
    expect(judgeJoined(makeCtx(cleanDir, 0), cleanJoined).verdict).toBe("fail");
    const passRes = judgeJoined(
      makeCtx(cleanDir, 1, new Set([keyString(s1FromShard1.key)])),
      cleanJoined,
    );
    expect(passRes.verdict).toBe("pass");
    expect(passRes.findings.at(-1)?.message).toContain(
      "1 unexplained survivors of 2 (1 explained), 1 excluded, at most 1 allowed",
    );
  });

  it("propagates shard timeout and shard starvation as not-evaluated, and keeps fail over starvation", () => {
    const timeoutDir = dirWith({
      "s2.json": makePartial({ shard: 2, timedOut: true }),
      "s1.json": makePartial({
        shard: 1,
        timedOut: true,
        counts: {
          killed: 0,
          timeout: 0,
          survived: 0,
          no_coverage: 0,
          runtime_error: 0,
          compile_error: 0,
          ignored: 0,
        },
      }),
    });
    const timed = judgeJoined(makeCtx(timeoutDir), loadJoined(timeoutDir));
    expect(timed.verdict).toBe("not-evaluated");
    expect(timed.reason).toContain("1/2, 2/2 timed out");
    expect(timed.metrics).toEqual({
      mutation: {
        killed: 2,
        timeout: 0,
        survived: 0,
        no_coverage: 0,
        runtime_error: 0,
        compile_error: 1,
        ignored: 0,
      },
    });

    const timeoutUnknownDir = dirWith({
      "s1.json": makePartial({ shard: 1, timedOut: true, unknown: ["Weird"] }),
      "s2.json": makePartial({ shard: 2 }),
    });
    expect(judgeJoined(makeCtx(timeoutUnknownDir), loadJoined(timeoutUnknownDir)).verdict).toBe(
      "fail",
    );

    const shardStarvedDir = dirWith({
      "s2.json": makePartial({
        shard: 2,
        starved: true,
        counts: {
          killed: 36,
          timeout: 0,
          survived: 0,
          no_coverage: 0,
          runtime_error: 0,
          compile_error: 0,
          ignored: 0,
        },
      }),
      "s1.json": makePartial({
        shard: 1,
        starved: true,
        counts: {
          killed: 1,
          timeout: 3,
          survived: 0,
          no_coverage: 0,
          runtime_error: 0,
          compile_error: 0,
          ignored: 0,
        },
      }),
    });
    const starvedRes = judgeJoined(makeCtx(shardStarvedDir), loadJoined(shardStarvedDir));
    expect(starvedRes.verdict).toBe("not-evaluated");
    expect(starvedRes.reason).toBe("shard 1/2, 2/2 timed out too many mutants (starved)");
    expect(starvedRes.findings[0]).toMatchObject({
      rule: "mutation-timeouts",
      verdict: "not-evaluated",
      message: "shard 1/2, 2/2 timed out too many mutants (starved)",
    });

    const starvedFailDir = dirWith({
      "s1.json": makePartial({
        shard: 1,
        starved: true,
        survivors: [survivor("src/a.ts::f")],
        counts: {
          killed: 20,
          timeout: 1,
          survived: 1,
          no_coverage: 0,
          runtime_error: 0,
          compile_error: 0,
          ignored: 0,
        },
      }),
      "s2.json": makePartial({
        shard: 2,
        counts: {
          killed: 20,
          timeout: 0,
          survived: 0,
          no_coverage: 0,
          runtime_error: 0,
          compile_error: 0,
          ignored: 0,
        },
      }),
    });
    expect(judgeJoined(makeCtx(starvedFailDir, 0), loadJoined(starvedFailDir)).verdict).toBe(
      "fail",
    );

    const sumStarvedDir = dirWith({
      "s1.json": makePartial({
        shard: 1,
        starved: false,
        counts: {
          killed: 8,
          timeout: 2,
          survived: 0,
          no_coverage: 0,
          runtime_error: 0,
          compile_error: 0,
          ignored: 0,
        },
      }),
      "s2.json": makePartial({
        shard: 2,
        starved: false,
        counts: {
          killed: 8,
          timeout: 2,
          survived: 0,
          no_coverage: 0,
          runtime_error: 0,
          compile_error: 0,
          ignored: 0,
        },
      }),
    });
    expect(judgeJoined(makeCtx(sumStarvedDir), loadJoined(sumStarvedDir)).verdict).toBe(
      "not-evaluated",
    );
  });
});
