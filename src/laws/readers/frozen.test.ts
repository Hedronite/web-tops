import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { frozenReader, judgeFrozen } from "./frozen.ts";
import { inputFor, lawOf } from "./testkit.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-frozen-"));
  roots.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const finding = (rule: string, message: string) => ({
  tool: "webtops",
  rule,
  verdict: "refuse",
  message,
  file: "web-tops.lock",
});

describe("W-40: judgeFrozen", () => {
  const LAW = lawOf("W-40", [{ tool: "bun", name: "install --frozen-lockfile" }]);
  const ran = (code: number | null): string =>
    JSON.stringify({ command: "bun install --frozen-lockfile", code });

  it("passes a committed lockfile and a frozen install that passed", () => {
    expect(judgeFrozen(LAW, ["bun.lock"], ran(0), false)).toEqual({
      law: "W-40",
      verdict: "pass",
      findings: [],
    });
  });

  it("refuses a project that does not commit bun.lock, whatever the install said, and never holds it", () => {
    const expected = {
      law: "W-40",
      verdict: "refuse",
      findings: [finding("lockfile-missing", "bun.lock is not committed")].map((item) => ({
        ...item,
        file: "bun.lock",
      })),
    };
    expect(judgeFrozen(LAW, ["src/a.ts"], ran(0), false)).toEqual(expected);
    expect(judgeFrozen(LAW, ["src/a.ts"], undefined, true)).toEqual(expected);
  });

  it("refuses a frozen install that failed, and names the code", () => {
    const reading = judgeFrozen(LAW, ["bun.lock"], ran(1), false);
    expect(reading.verdict).toBe("refuse");
    expect(reading.findings).toEqual([
      {
        tool: "webtops",
        rule: "install-failed",
        verdict: "refuse",
        message: "bun install --frozen-lockfile exited 1",
        file: "bun.lock",
      },
    ]);
  });

  it("names a process that never exited", () => {
    expect(judgeFrozen(LAW, ["bun.lock"], ran(null), false).findings[0]?.message).toBe(
      "bun install --frozen-lockfile exited null",
    );
  });

  it("holds a failed install under a ratchet baseline", () => {
    expect(judgeFrozen(LAW, ["bun.lock"], ran(1), true)).toEqual({
      law: "W-40",
      verdict: "pass",
      findings: [],
      note: "1 held by the baseline",
    });
  });

  it.each([undefined, "", "not json", "[]", "{}", '{"code":"0"}'])(
    "is not evaluated when gate 1 kept %j: an install that did not run is never a pass",
    (text) => {
      expect(judgeFrozen(LAW, ["bun.lock"], text, false)).toEqual({
        law: "W-40",
        verdict: "not-evaluated",
        reason: "gate 1 kept no result of bun install --frozen-lockfile: the install did not run",
        findings: [],
      });
    },
  );
});

describe("frozenReader", () => {
  const LAW = lawOf("W-40", [{ tool: "bun", name: "install --frozen-lockfile" }]);

  it("reads the install result gate 1 kept, and the tracked files", async () => {
    const dir = project({ "out/install.json": '{"code":2}' });
    const readings = await frozenReader(
      inputFor([LAW], {
        tracked: ["bun.lock"],
        artifacts: { "install-json": join(dir, "out/install.json") },
      }),
    );
    expect(readings[0]?.findings[0]?.message).toBe("bun install --frozen-lockfile exited 2");
  });

  it("is not evaluated with no install result", async () => {
    const readings = await frozenReader(inputFor([LAW], { tracked: ["bun.lock"] }));
    expect(readings[0]?.verdict).toBe("not-evaluated");
  });
});
