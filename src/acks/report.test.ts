import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ackLedgerReport } from "./report.ts";
import type { SeverityOf } from "./severity.ts";

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-ack-report-"));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const SEVERITY: SeverityOf = (law) =>
  new Map<string, "R" | "A">([
    ["W-28", "A"],
    ["W-04", "R"],
  ]).get(law);

const entry = (law: string, file: string): string =>
  `  - law: ${law}\n    file: ${file}\n    reason: Reviewed with the owner.\n    owner: web-platform\n`;

function report(files: Readonly<Record<string, string>>) {
  let asked = 0;
  const text = ackLedgerReport(project(files), ".web-tops/acks.yaml", () => {
    asked += 1;
    return SEVERITY;
  });
  return { text, asked };
}

describe("ackLedgerReport: what `webtops check` says of the ack ledger", () => {
  it("says nothing of a ledger that is absent, and does not ask for the laws", () => {
    expect(report({})).toEqual({ text: undefined, asked: 0 });
  });

  it("says nothing of a ledger whose entries are all of soft laws", () => {
    const text = `version: 1\nacks:\n${entry("W-28", "src/a.astro")}`;
    expect(report({ ".web-tops/acks.yaml": text })).toEqual({ text: undefined, asked: 1 });
  });

  it("names a ledger that cannot be read, with the pointer of each problem, and does not ask for the laws", () => {
    const found = report({ ".web-tops/acks.yaml": "version: 1\nacks:\n  - law: W-28\n" });
    expect(found.asked).toBe(0);
    expect(found.text).toMatch(
      /^\.web-tops\/acks\.yaml: invalid\n {2}ack-ledger-unreadable: \/acks\/0\/file: /u,
    );
  });

  it("names an entry of a hard law and one of an unknown id, one line each, under the ledger's path", () => {
    const text = `version: 1\nacks:\n${entry("W-04", "src/a.ts")}${entry("W-99", "src/b.ts")}${entry("W-28", "src/c.astro")}`;
    expect(report({ ".web-tops/acks.yaml": text }).text).toBe(
      [
        ".web-tops/acks.yaml: invalid",
        "  ack-not-needed: src/a.ts: W-04 is a hard law: a break is refused, and no acknowledgement turns it into a pass",
        "  ack-unknown-law: src/b.ts: W-99 is not a law",
        "",
      ].join("\n"),
    );
  });
});
