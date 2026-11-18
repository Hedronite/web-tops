import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDiff } from "./parse.ts";

const probe = join(import.meta.dirname, "../../fixtures/probe/test-only-diff/changes.diff");

function diff(...lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

describe("G6a: the changed ranges of a unified diff", () => {
  it("reads the probe's test-only diff, with its context lines: the new-side lines 1 and 5", () => {
    expect(parseDiff(readFileSync(probe, "utf8"))).toEqual([
      {
        path: "src/sum.test.ts",
        status: "modified",
        ranges: [
          { start: 1, end: 1 },
          { start: 5, end: 5 },
        ],
        removedAfter: [],
      },
    ]);
  });

  it("reads -U0 hunks: an addition, a one-line change without a length, and a pure deletion", () => {
    const text = diff(
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -2,0 +3,2 @@",
      "+one",
      "+two",
      "@@ -5 +7 @@",
      "-old",
      "+new",
      "@@ -9,2 +10,0 @@",
      "-gone",
      "-gone",
    );
    expect(parseDiff(text)).toEqual([
      {
        path: "src/a.ts",
        status: "modified",
        ranges: [
          { start: 3, end: 4 },
          { start: 7, end: 7 },
        ],
        removedAfter: [10],
      },
    ]);
  });

  it("joins consecutive added lines into one range, across a change that also removes lines", () => {
    const text = diff("--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +1,3 @@", "-a", "-b", "+A", "+B", "+C");
    expect(parseDiff(text)[0]?.ranges).toEqual([{ start: 1, end: 3 }]);
    expect(parseDiff(text)[0]?.removedAfter).toEqual([]);
  });

  it("marks an added file and a deleted file, and gives a deleted file no ranges", () => {
    const text = diff(
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,3 @@",
      "+a",
      "+b",
      "+c",
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-a",
      "-b",
    );
    expect(parseDiff(text)).toEqual([
      { path: "new.ts", status: "added", ranges: [{ start: 1, end: 3 }], removedAfter: [] },
      { path: "old.ts", status: "deleted", ranges: [], removedAfter: [] },
    ]);
  });

  it("reads paths with spaces (git adds a trailing tab) and quoted paths", () => {
    const text = diff(
      "--- a/dir/a b.ts",
      "+++ b/dir/a b.ts\t",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      '--- "a/we\\"ird.ts"',
      '+++ "b/we\\"ird.ts"',
      "@@ -1 +1 @@",
      "-x",
      "+y",
    );
    expect(parseDiff(text).map((file) => file.path)).toEqual(["dir/a b.ts", 'we"ird.ts']);
  });

  it("lists no file for a binary change, and nothing for an empty diff", () => {
    expect(
      parseDiff(diff("diff --git a/x.png b/x.png", "Binary files a/x.png and b/x.png differ")),
    ).toEqual([]);
    expect(parseDiff("")).toEqual([]);
  });
});
