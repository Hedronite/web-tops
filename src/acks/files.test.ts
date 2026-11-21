import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ackedFiles, ledgerPath, namedLedger } from "./files.ts";
import type { SeverityOf } from "./severity.ts";

/** Soft laws W-28, W-30 and W-31, the hard law W-04, and no other id. */
const SEVERITY: SeverityOf = (law) =>
  new Map<string, "R" | "A">([
    ["W-28", "A"],
    ["W-30", "A"],
    ["W-31", "A"],
    ["W-04", "R"],
  ]).get(law);

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-acked-"));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const entry = (law: string, file: string, expires?: string): string =>
  [
    `  - law: ${law}`,
    `    file: ${file}`,
    "    reason: Reviewed with the owner.",
    "    owner: web-platform",
    ...(expires === undefined ? [] : [`    expires: ${expires}`]),
  ].join("\n");

const ledger = (...entries: string[]): string => `version: 1\nacks:\n${entries.join("\n")}\n`;

describe("ackedFiles: the files a law has a valid ledger entry for", () => {
  it("lists the files of the law, in path order, and none of another law", () => {
    const dir = project({
      ".web-tops/acks.yaml": ledger(
        entry("W-28", "src/pages/b.astro"),
        entry("W-30", "src/pages/c.astro"),
        entry("W-28", "src/pages/a.astro"),
      ),
    });
    expect(ackedFiles(dir, "W-28", "2026-11-20", SEVERITY)).toEqual({
      ok: true,
      files: ["src/pages/a.astro", "src/pages/b.astro"],
    });
    expect(ackedFiles(dir, "W-31", "2026-11-20", SEVERITY)).toEqual({ ok: true, files: [] });
  });

  it("reads the ledger it is given, not the one the config file names", () => {
    const dir = project({
      "web-tops.yaml": "laws:\n  ack_ledger: named/acks.yaml\n",
      "named/acks.yaml": ledger(entry("W-28", "src/named.astro")),
      "given/acks.yaml": ledger(entry("W-28", "src/given.astro")),
    });
    expect(ackedFiles(dir, "W-28", "2026-11-20", SEVERITY)).toEqual({
      ok: true,
      files: ["src/named.astro"],
    });
    expect(ackedFiles(dir, "W-28", "2026-11-20", SEVERITY, "given/acks.yaml")).toEqual({
      ok: true,
      files: ["src/given.astro"],
    });
  });

  it("an entry is valid through the day it names, and an expired one acknowledges nothing", () => {
    const dir = project({
      ".web-tops/acks.yaml": ledger(
        entry("W-28", "src/a.astro", "2026-11-20"),
        entry("W-28", "src/b.astro", "2026-11-19"),
        entry("W-28", "src/c.astro", "2026-12-31"),
      ),
    });
    expect(ackedFiles(dir, "W-28", "2026-11-20", SEVERITY)).toEqual({
      ok: true,
      files: ["src/a.astro", "src/c.astro"],
    });
  });

  it("a hard law, and an id that is no law, have no file, though the ledger has entries for them", () => {
    const dir = project({
      ".web-tops/acks.yaml": ledger(entry("W-04", "src/a.astro"), entry("W-99", "src/b.astro")),
    });
    expect(ackedFiles(dir, "W-04", "2026-11-20", SEVERITY)).toEqual({ ok: true, files: [] });
    expect(ackedFiles(dir, "W-99", "2026-11-20", SEVERITY)).toEqual({ ok: true, files: [] });
  });

  it("no ledger is an empty list, not a problem", () => {
    expect(ackedFiles(project({ "a.txt": "x" }), "W-28", "2026-11-20", SEVERITY)).toEqual({
      ok: true,
      files: [],
    });
  });

  it("an unreadable ledger is a problem that names the rule and the ledger, never an empty list", () => {
    const dir = project({ ".web-tops/acks.yaml": "version: 2\nacks: []\n" });
    const found = ackedFiles(dir, "W-28", "2026-11-20", SEVERITY);
    expect(found.ok).toBe(false);
    expect(found).toMatchObject({ rule: "ack-ledger-unreadable", file: ".web-tops/acks.yaml" });
    expect(!found.ok && found.message).toContain("version");
  });

  it("a ledger path that leaves the project is a problem too", () => {
    const dir = project({ "web-tops.yaml": "laws:\n  ack_ledger: ../acks.yaml\n" });
    expect(ackedFiles(dir, "W-28", "2026-11-20", SEVERITY)).toMatchObject({
      ok: false,
      rule: "ack-ledger-unreadable",
      file: "../acks.yaml",
    });
  });

  it("reads the ledger the config names in laws.ack_ledger", () => {
    const dir = project({
      "web-tops.yaml": "laws:\n  ack_ledger: ops/acks.yaml\n",
      "ops/acks.yaml": ledger(entry("W-28", "src/x.astro")),
      ".web-tops/acks.yaml": ledger(entry("W-28", "src/default.astro")),
    });
    expect(ackedFiles(dir, "W-28", "2026-11-20", SEVERITY)).toEqual({
      ok: true,
      files: ["src/x.astro"],
    });
  });
});

describe("ledgerPath: the ledger the config names, else the default", () => {
  it("is .web-tops/acks.yaml with no config, and with a config that names none", () => {
    expect(ledgerPath(project({}))).toBe(".web-tops/acks.yaml");
    expect(ledgerPath(project({ "web-tops.yaml": "class: web-app\n" }))).toBe(
      ".web-tops/acks.yaml",
    );
  });

  it("is the path laws.ack_ledger names, and ignores a value that is not a string", () => {
    expect(ledgerPath(project({ "web-tops.yaml": "laws:\n  ack_ledger: a/b.yaml\n" }))).toBe(
      "a/b.yaml",
    );
    expect(ledgerPath(project({ "web-tops.yaml": "laws:\n  ack_ledger: 7\n" }))).toBe(
      ".web-tops/acks.yaml",
    );
  });
});

describe("namedLedger: the ledger a validated config names", () => {
  it("is the one `laws.ack_ledger` names, else the default path", () => {
    expect(namedLedger({ laws: { ack_ledger: "docs/acks.yaml" } })).toBe("docs/acks.yaml");
    expect(namedLedger({ laws: {} })).toBe(".web-tops/acks.yaml");
    expect(namedLedger({})).toBe(".web-tops/acks.yaml");
  });
});
