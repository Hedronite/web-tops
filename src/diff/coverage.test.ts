import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Exec } from "../gate/types.ts";
import { coveredSpans, parseCoverage, vitestCoverageOf } from "./coverage.ts";

const recorded: unknown = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../fixtures/probe/test-only-diff/recorded/coverage-final.json"),
    "utf8",
  ),
);

describe("G6c: the functions a test run covers, from Istanbul coverage JSON", () => {
  it("reads the probe's recorded coverage: sum ran once", () => {
    const map = parseCoverage(recorded);
    expect([...(map?.keys() ?? [])]).toEqual(["src/sum.ts"]);
    expect(map?.get("src/sum.ts")).toEqual([{ start: 1, end: 7, hits: 1 }]);
  });

  it("strips an absolute work-tree prefix from a path", () => {
    const map = parseCoverage(
      {
        "/work/src/a.ts": {
          fnMap: { 0: { loc: { start: { line: 2 }, end: { line: 4 } } } },
          f: { 0: 2 },
        },
      },
      "/work",
    );
    expect([...(map?.keys() ?? [])]).toEqual(["src/a.ts"]);
  });

  it.each([null, 3, "x", [], { "a.ts": 1 }, { "a.ts": { fnMap: {}, f: [] } }])(
    "refuses %j",
    (value) => {
      expect(parseCoverage(value)).toBeUndefined();
    },
  );

  it("keeps only functions that ran, matched to the innermost span that holds them", () => {
    const spans = [
      { key: "a.ts::<module>", start: 1, end: 20 },
      { key: "a.ts::f", start: 3, end: 10 },
      { key: "a.ts::f#1", start: 5, end: 6 },
      { key: "a.ts::g", start: 12, end: 15 },
    ];
    const hits = [
      { start: 3, end: 10, hits: 1 },
      { start: 5, end: 6, hits: 0 },
      { start: 12, end: 15, hits: 0 },
    ];
    expect(coveredSpans(spans, hits).map((span) => span.key)).toEqual(["a.ts::f"]);
  });
});

describe("G6c: running one changed test file for its coverage", () => {
  const stamp =
    (dir: string, code: number, write: boolean): Exec =>
    (command, args) => {
      const flag = args.find((arg) => arg.startsWith("--coverage.reportsDirectory="));
      const out = flag?.slice("--coverage.reportsDirectory=".length) ?? "";
      if (write) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, "coverage-final.json"), JSON.stringify(recorded));
      }
      log.push([command, ...args, dir]);
      return Promise.resolve({ code, stdout: "", stderr: "" });
    };
  const log: string[][] = [];

  it("runs vitest on that file alone with the JSON reporter, and reads coverage-final.json", async () => {
    const map = await vitestCoverageOf("src/sum.test.ts", {
      cwd: "/repo",
      exec: stamp("/repo", 0, true),
    });
    expect(map?.get("src/sum.ts")).toHaveLength(1);
    const call = log.at(-1) ?? [];
    expect(call[0]).toContain("vitest");
    expect(call).toEqual(
      expect.arrayContaining(["run", "src/sum.test.ts", "--coverage", "--coverage.reporter=json"]),
    );
  });

  it("gives undefined when vitest fails or writes no coverage", async () => {
    expect(
      await vitestCoverageOf("src/sum.test.ts", { cwd: "/repo", exec: stamp("/repo", 1, true) }),
    ).toBeUndefined();
    expect(
      await vitestCoverageOf("src/sum.test.ts", { cwd: "/repo", exec: stamp("/repo", 0, false) }),
    ).toBeUndefined();
  });
});
