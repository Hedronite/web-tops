import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Exec } from "../gate/types.ts";
import { vitestCoverageOf, vitestCoverageOfMany } from "./coverage.ts";

const REPORT = {
  "/repo/src/a.ts": {
    fnMap: { 0: { loc: { start: { line: 1 }, end: { line: 3 } } } },
    f: { 0: 1 },
  },
};

/** An exec that writes the report for a run that exits 0, and keeps the arguments of every run. */
function stamped(log: string[][], code = 0): Exec {
  return (command, args) => {
    const flag = args.find((arg) => arg.startsWith("--coverage.reportsDirectory="));
    const out = flag?.slice("--coverage.reportsDirectory=".length) ?? "";
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "coverage-final.json"), JSON.stringify(REPORT));
    log.push([command, ...args]);
    return Promise.resolve({ code, stdout: "", stderr: "" });
  };
}

describe("vitestCoverageOfMany", () => {
  it("runs Vitest once on every file it is given, and reads one map", async () => {
    const log: string[][] = [];
    const map = await vitestCoverageOfMany(["src/a.test.ts", "src/b.test.ts"], {
      cwd: "/repo",
      exec: stamped(log),
    });
    expect(log).toHaveLength(1);
    const args = log[0] ?? [];
    expect(args.slice(1, 4)).toEqual(["run", "src/a.test.ts", "src/b.test.ts"]);
    expect(map?.get("src/a.ts")).toEqual([{ start: 1, end: 3, hits: 1 }]);
  });

  it("is undefined when the run fails, whichever file is the cause", async () => {
    const map = await vitestCoverageOfMany(["src/a.test.ts", "src/b.test.ts"], {
      cwd: "/repo",
      exec: stamped([], 1),
    });
    expect(map).toBeUndefined();
  });

  it("is, for one file, the run of that file alone", async () => {
    const log: string[][] = [];
    await vitestCoverageOf("src/a.test.ts", { cwd: "/repo", exec: stamped(log) });
    expect((log[0] ?? []).slice(1, 3)).toEqual(["run", "src/a.test.ts"]);
    expect((log[0] ?? []).filter((arg) => arg.endsWith(".test.ts"))).toEqual(["src/a.test.ts"]);
  });
});
