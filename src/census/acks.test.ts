import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { censusKindOf } from "../baseline/census.ts";
import type { Finding } from "../config/report.ts";
import { directivesFor, ledgerFindings } from "./index.ts";

// G8c: acknowledgements are a census kind, `webtops-ack`: each comment and each ledger entry counts (WEB_TOPS.md 6.7).

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-census-acks-"));
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
  "  - law: W-28",
  "    file: src/pages/index.astro",
  "    reason: The hero must be interactive at once.",
  "    owner: web-platform",
  "  - law: W-30",
  "    file: src/pages/about.astro",
  "    reason: A remote image with no known size.",
  "    owner: web-platform",
  "",
].join("\n");

const summary = (
  found: readonly { rule: string; verdict: string; file?: string; line?: number }[],
) =>
  found.map((item) => `${item.rule} ${item.verdict} ${item.file ?? ""}:${String(item.line ?? "")}`);

describe("the census counts the acknowledgement comments of a file", () => {
  it("counts a comment as a passing webtops-ack item, and a reasonless one also as a failing finding", () => {
    const text =
      "---\n---\n<!-- webtops-ack W-28: why -->\n<!-- webtops-ack W-30: -->\n<!-- webtops-ack -->\n";
    const dir = project({ "src/a.astro": text });
    expect(summary(directivesFor(dir, "src/a.astro"))).toEqual([
      "census/webtops-ack pass src/a.astro:3",
      "census/webtops-ack pass src/a.astro:4",
      "ack-no-reason fail src/a.astro:4",
      "census/webtops-ack pass src/a.astro:5",
      "ack-malformed fail src/a.astro:5",
    ]);
  });

  it("counts them with the suppression directives, in line order", () => {
    const dir = project({ "src/a.ts": "// @ts-ignore: why\n// webtops-ack W-01: why\n" });
    expect(summary(directivesFor(dir, "src/a.ts"))).toEqual([
      "census/ts-ignore pass src/a.ts:1",
      "census/webtops-ack pass src/a.ts:2",
    ]);
  });

  it("finds nothing in a file it cannot read", () => {
    expect(directivesFor(project({}), "src/missing.ts")).toEqual([]);
  });
});

describe("the census counts the entries of the ack ledger", () => {
  it("counts each entry, in the file it names, with the law", () => {
    const dir = project({ ".web-tops/acks.yaml": LEDGER });
    const found = ledgerFindings(dir, ".web-tops/acks.yaml");
    expect(summary(found)).toEqual([
      "census/webtops-ack pass src/pages/index.astro:",
      "census/webtops-ack pass src/pages/about.astro:",
    ]);
    expect(found[0]?.message).toBe(
      "W-28: an acknowledgement records a broken soft law as accepted here",
    );
  });

  it("does not read a ledger when no path is given", () => {
    expect(ledgerFindings(project({ ".web-tops/acks.yaml": LEDGER }), undefined)).toEqual([]);
  });

  it("counts an absent ledger as nothing", () => {
    expect(ledgerFindings(project({}), ".web-tops/acks.yaml")).toEqual([]);
  });

  it("names every problem of a ledger that cannot be read, apart by a semicolon", () => {
    const text =
      "version: 1\nacks:\n  - law: W-28\n    reason: a\n    owner: me\n  - law: W-30\n    reason: b\n    owner: me\n";
    const found = ledgerFindings(project({ ".web-tops/acks.yaml": text }), ".web-tops/acks.yaml");
    expect(found[0]?.message).toBe(
      "/acks/0/file: must have required property 'file'; /acks/1/file: must have required property 'file'",
    );
  });

  it("fails, never counts zero, for a ledger that cannot be read", () => {
    const dir = project({ ".web-tops/acks.yaml": "version: 1\nacks:\n  - law: W-28\n" });
    const found = ledgerFindings(dir, ".web-tops/acks.yaml");
    expect(summary(found)).toEqual(["ack-ledger-unreadable fail .web-tops/acks.yaml:"]);
    expect(found[0]?.message).toContain("/acks/0/file");
  });
});

describe("baseline and ratchet hold acknowledgements", () => {
  it("maps the census/webtops-ack finding to the kind webtops-ack, which the baseline counts like any kind", () => {
    const finding = (rule: string): Finding => ({
      tool: "webtops",
      rule,
      law: null,
      verdict: "pass",
      message: "m",
      file: "a.ts",
      line: 1,
      fingerprint: "fp1:0000000000000000",
    });
    expect(censusKindOf(finding("census/webtops-ack"))).toBe("webtops-ack");
    expect(censusKindOf(finding("ack-no-reason"))).toBeUndefined();
  });
});
