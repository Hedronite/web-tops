import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import pkg from "../../../package.json" with { type: "json" };
import { NODE_RANGE } from "../../lock/pins.ts";
import { lockFindings, lockReader } from "./lock.ts";
import { inputFor, lawOf } from "./testkit.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-lock-"));
  roots.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const installedTypescript = (version: string): Record<string, string> => ({
  "node_modules/typescript/package.json": JSON.stringify({ name: "typescript", version }),
});

const lockText = (typescript: string): string =>
  `typescript: ${typescript}\nwebtops: ${pkg.version}\nnode: "${NODE_RANGE}"\n`;

const finding = (rule: string, message: string) => ({
  tool: "webtops",
  rule,
  verdict: "refuse",
  message,
  file: "web-tops.lock",
});

describe("W-41: lockFindings", () => {
  it("refuses a project with no web-tops.lock", () => {
    expect(lockFindings(project({}), process.env)).toEqual([
      finding("lock-missing", "no web-tops.lock is committed"),
    ]);
  });

  it("refuses a lock that cannot be read, with what the reader said", () => {
    const found = lockFindings(project({ "web-tops.lock": "typescript: [" }), process.env);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: "lock-unreadable", file: "web-tops.lock" });
    expect(found[0]?.message).toContain("web-tops.lock");
  });

  it("is quiet when the installed tools are the locked ones", () => {
    const dir = project({ "web-tops.lock": lockText("6.0.3"), ...installedTypescript("6.0.3") });
    expect(lockFindings(dir, process.env)).toEqual([]);
  });

  it("refuses a tool installed at another version than the lock names, one finding for each difference", () => {
    const dir = project({ "web-tops.lock": lockText("6.0.3"), ...installedTypescript("5.0.0") });
    expect(lockFindings(dir, process.env)).toEqual([
      finding("lock-mismatch", "typescript: locked 6.0.3, installed 5.0.0"),
    ]);
  });
});

describe("lockReader", () => {
  const LAW = lawOf("W-41", [{ tool: "lock", name: "web-tops.lock" }]);

  it("reads each law over the findings, and passes when there are none", async () => {
    const good = project({ "web-tops.lock": lockText("6.0.3"), ...installedTypescript("6.0.3") });
    expect(await lockReader(inputFor([LAW], { cwd: good }))).toEqual([
      { law: "W-41", verdict: "pass", findings: [] },
    ]);
    const bad = project({ "web-tops.lock": lockText("6.0.3"), ...installedTypescript("5.0.0") });
    const readings = await lockReader(inputFor([LAW], { cwd: bad }));
    expect(readings[0]).toMatchObject({ law: "W-41", verdict: "refuse" });
    expect(readings[0]?.findings).toHaveLength(1);
  });

  it("does not hold the findings: a ratchet counts findings, and the lock is not one", async () => {
    const bad = project({ "web-tops.lock": lockText("6.0.3"), ...installedTypescript("5.0.0") });
    const readings = await lockReader(inputFor([LAW], { cwd: bad, held: true }));
    expect(readings[0]?.verdict).toBe("refuse");
  });
});
