import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDiff } from "./parse.ts";
import type { ChangedFile } from "./types.ts";

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

describe("G6a: the data trees of section 17 are not part of the diff", () => {
  const change = (path: string): string[] => [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ];

  it("leaves out a file changed under fixtures/, probes/ or examples/, and keeps the others with their own ranges", () => {
    const text = diff(
      ...change("src/a.ts"),
      ...change("fixtures/laws/W-34/bad/focused.test.ts"),
      ...change("probes/w22/b.tsx"),
      ...change("examples/node-service/src/a.test.ts"),
      "@@ -5,0 +6,2 @@",
      "+x",
      "+y",
      ...change("src/c.ts"),
    );
    expect(parseDiff(text).map((file) => [file.path, file.ranges])).toEqual([
      ["src/a.ts", [{ start: 1, end: 1 }]],
      ["src/c.ts", [{ start: 1, end: 1 }]],
    ]);
  });

  it("the hunks of a data file do not attach to the file before it, added, deleted or modified", () => {
    const added = diff(
      ...change("src/a.ts"),
      "diff --git a/fixtures/x.ts b/fixtures/x.ts",
      "--- /dev/null",
      "+++ b/fixtures/x.ts",
      "@@ -0,0 +1,3 @@",
      "+1",
      "+2",
      "+3",
    );
    expect(parseDiff(added)).toEqual([
      { path: "src/a.ts", status: "modified", ranges: [{ start: 1, end: 1 }], removedAfter: [] },
    ]);
    const deleted = diff(
      ...change("src/a.ts"),
      "diff --git a/probes/y.ts b/probes/y.ts",
      "--- a/probes/y.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-1",
      "-2",
    );
    expect(parseDiff(deleted).map((file) => [file.path, file.removedAfter])).toEqual([
      ["src/a.ts", []],
    ]);
  });

  it("only the trees at the top: a path that merely contains or starts like one is kept", () => {
    const text = diff(
      ...change("src/fixtures/a.ts"),
      ...change("docs/examples/b.ts"),
      ...change("fixtures-old/c.ts"),
      ...change("probes.ts"),
      ...change("examples.ts"),
    );
    expect(parseDiff(text).map((file) => file.path)).toEqual([
      "src/fixtures/a.ts",
      "docs/examples/b.ts",
      "fixtures-old/c.ts",
      "probes.ts",
      "examples.ts",
    ]);
  });

  it("a diff that changes only a data tree lists nothing", () => {
    expect(parseDiff(diff(...change("fixtures/laws/W-01/bad/a.ts")))).toEqual([]);
  });
});

describe("G6a: the hunks of a unified diff, line by line", () => {
  const file = (...body: string[]): string =>
    diff("diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts", ...body);
  const only = (text: string): ChangedFile => {
    const found = parseDiff(text)[0];
    if (found === undefined) throw new Error("no file was read");
    return found;
  };

  it("reads a header whose numbers have several digits, and only a header at the start of a line", () => {
    const wide = only(file("@@ -100,12 +120,13 @@", "+x"));
    expect(wide.ranges).toEqual([{ start: 120, end: 120 }]);
    const lengths = only(
      file("@@ -1,12 +1,12 @@", " c1", "+x", ...Array.from({ length: 10 }, () => " c")),
    );
    expect(lengths.ranges).toEqual([{ start: 2, end: 2 }]);
    expect(only(file("@@ junk @@ -3 +3 @@", "+z")).ranges).toEqual([]);
  });

  it("closes a block at each context line: a removal before one is recorded there, once", () => {
    expect(only(file("@@ -1,3 +1,2 @@", "-a", " x", " y")).removedAfter).toEqual([0]);
    expect(only(file("@@ -1,3 +1,2 @@", " x", " y", "-a")).removedAfter).toEqual([2]);
  });

  it("a hunk that opens on context has no removal before it", () => {
    expect(only(file("@@ -1,2 +1,2 @@", " x", "-y", "+z")).removedAfter).toEqual([]);
  });

  it("a removal after the last context line of a hunk is recorded, and the hunk ends with its last line", () => {
    const text = file("@@ -1,2 +1 @@", " x", "-y", "@@ -9 +8,0 @@", "-w");
    expect(only(text).removedAfter).toEqual([1, 8]);
  });

  it("reads a quoted path with its escapes, and an unquoted path that merely ends in a quote", () => {
    const raw = String.raw`+++ "b/we\\ird\t\n\"name.ts"`;
    const quoted = diff("--- a/x", raw, "@@ -0,0 +1 @@", "+x");
    expect(parseDiff(quoted).map((entry) => entry.path)).toEqual(['we\\ird\t\n"name.ts']);
    const ends = diff("--- a/x", '+++ b/src/q"', "@@ -0,0 +1 @@", "+x");
    expect(parseDiff(ends).map((entry) => entry.path)).toEqual(['src/q"']);
  });

  it("takes off only the a/ or b/ prefix at the start of a path, and git's trailing tab", () => {
    const text = diff("--- a/src/a/x.ts\tstamp", "+++ b/src/a/x.ts\tstamp", "@@ -0,0 +1 @@", "+x");
    expect(parseDiff(text).map((entry) => entry.path)).toEqual(["src/a/x.ts"]);
  });

  it("leaves a path with no prefix alone, though an a/ or b/ lies inside it", () => {
    const text = diff("--- src/a/x.ts", "+++ src/b/x.ts", "@@ -0,0 +1 @@", "+x");
    expect(parseDiff(text).map((entry) => entry.path)).toEqual(["src/b/x.ts"]);
  });
});
