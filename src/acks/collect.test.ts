import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectAcks } from "./collect.ts";
import type { SeverityOf } from "./severity.ts";

/** Soft laws W-01, W-02, W-28 and W-30, the hard law W-04, and no other id. */
const SEVERITY: SeverityOf = (law) =>
  new Map<string, "R" | "A">([
    ["W-01", "A"],
    ["W-02", "A"],
    ["W-28", "A"],
    ["W-30", "A"],
    ["W-04", "R"],
  ]).get(law);

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-collect-"));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const LEDGER = [
  "version: 1",
  "acks:",
  "  - law: W-30",
  "    file: src/about.astro",
  "    reason: A remote image with no known size.",
  "    owner: web-platform",
  "",
].join("\n");

describe("collectAcks", () => {
  it("collects a comment in each kind of file, and each entry of the ledger", () => {
    const files = {
      "src/a.ts": "// webtops-ack W-01: a reason\n",
      "src/b.astro": "---\n---\n<p/>\n<!-- webtops-ack W-28: another -->\n",
      ".web-tops/acks.yaml": LEDGER,
    };
    const found = collectAcks(
      project(files),
      ["src/a.ts", "src/b.astro"],
      ".web-tops/acks.yaml",
      SEVERITY,
    );
    expect(found.problems).toEqual([]);
    expect(found.acks).toEqual([
      { source: "comment", law: "W-01", file: "src/a.ts", line: 1, reason: "a reason" },
      { source: "comment", law: "W-28", file: "src/b.astro", line: 4, reason: "another" },
      {
        source: "ledger",
        law: "W-30",
        file: "src/about.astro",
        reason: "A remote image with no known size.",
      },
    ]);
  });

  it("gives each comment that is no acknowledgement as a problem at its file and line, beside the good ones", () => {
    const found = collectAcks(
      project({
        "src/a.ts": "// webtops-ack W-01\n// webtops-ack W-01: why\n// webtops-ack nonsense\n",
      }),
      ["src/a.ts"],
      ".web-tops/acks.yaml",
      SEVERITY,
    );
    expect(found.acks).toHaveLength(1);
    expect(
      found.problems.map((problem) => `${problem.file}:${String(problem.line)} ${problem.rule}`),
    ).toEqual(["src/a.ts:1 ack-no-reason", "src/a.ts:3 ack-malformed"]);
  });

  it("reads no file that holds no comments, is not tracked source, or is gone", () => {
    const dir = project({
      "README.md": "<!-- webtops-ack W-01: not read -->\n",
      "node_modules/p/a.ts": "// webtops-ack W-01: not source\n",
    });
    const found = collectAcks(
      dir,
      ["README.md", "node_modules/p/a.ts", "src/gone.ts"],
      "acks.yaml",
      SEVERITY,
    );
    expect(found).toEqual({ acks: [], problems: [] });
  });

  it("ignores the other comments of a file, beside its acknowledgements", () => {
    const found = collectAcks(
      project({
        "src/a.ts": "// eslint-disable-next-line no-console\n// webtops-ack W-01: a reason\n",
      }),
      ["src/a.ts"],
      "none.yaml",
      SEVERITY,
    );
    expect(found.acks).toHaveLength(1);
    expect(found.problems).toEqual([]);
  });

  it("gives an unreadable ledger as one problem at the ledger, never as no acknowledgement", () => {
    const found = collectAcks(
      project({ "acks.yaml": "version: 1\nacks:\n  - law: W-28\n" }),
      [],
      "acks.yaml",
      SEVERITY,
    );
    expect(found.acks).toEqual([]);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toMatchObject({ file: "acks.yaml", rule: "ack-ledger-unreadable" });
    expect(found.problems[0]?.message).toContain("/acks/0/file");
    expect(found.problems[0]?.message).toMatch(/; /);
  });
});

describe("collectAcks: an acknowledgement of a law that needs none, or of an id that is no law, is a problem", () => {
  const HARD = "hard law: a break is refused, and no acknowledgement turns it into a pass";

  it("fails a comment that names a hard law, at its file and line, and counts it as no acknowledgement", () => {
    const found = collectAcks(
      project({ "src/a.ts": "x();\n// webtops-ack W-04: a reason\n" }),
      ["src/a.ts"],
      "none.yaml",
      SEVERITY,
    );
    expect(found.acks).toEqual([]);
    expect(found.problems).toEqual([
      {
        file: "src/a.ts",
        line: 2,
        rule: "ack-not-needed",
        message: `W-04 is a ${HARD}`,
      },
    ]);
  });

  it("fails a comment that names an id that is no law", () => {
    const found = collectAcks(
      project({ "src/a.ts": "// webtops-ack W-99: a reason\n" }),
      ["src/a.ts"],
      "none.yaml",
      SEVERITY,
    );
    expect(found.acks).toEqual([]);
    expect(found.problems).toEqual([
      { file: "src/a.ts", line: 1, rule: "ack-unknown-law", message: "W-99 is not a law" },
    ]);
  });

  it("passes a comment that names a soft law", () => {
    const found = collectAcks(
      project({ "src/a.ts": "// webtops-ack W-28: a reason\n" }),
      ["src/a.ts"],
      "none.yaml",
      SEVERITY,
    );
    expect(found.problems).toEqual([]);
    expect(found.acks).toHaveLength(1);
  });

  const entry = (law: string, file: string): string =>
    `  - law: ${law}\n    file: ${file}\n    reason: Reviewed with the owner.\n    owner: web-platform\n`;

  it("fails a ledger entry for a hard law or an unknown id, at the ledger naming the entry's file, and keeps the soft one", () => {
    const text = `version: 1\nacks:\n${entry("W-04", "src/a.ts")}${entry("W-99", "src/b.ts")}${entry("W-28", "src/c.astro")}`;
    const found = collectAcks(project({ "acks.yaml": text }), [], "acks.yaml", SEVERITY);
    expect(found.acks.map((ack) => `${ack.law} ${ack.file}`)).toEqual(["W-28 src/c.astro"]);
    expect(found.problems).toEqual([
      { file: "acks.yaml", rule: "ack-not-needed", message: `src/a.ts: W-04 is a ${HARD}` },
      { file: "acks.yaml", rule: "ack-unknown-law", message: "src/b.ts: W-99 is not a law" },
    ]);
  });

  it("lists the problems of the comments before those of the laws, and each once", () => {
    const found = collectAcks(
      project({ "src/a.ts": "// webtops-ack W-04: why\n// webtops-ack W-01\n" }),
      ["src/a.ts"],
      "none.yaml",
      SEVERITY,
    );
    expect(found.problems.map((problem) => problem.rule)).toEqual([
      "ack-no-reason",
      "ack-not-needed",
    ]);
  });
});
