import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { anchorOf, fingerprint } from "../report/findings.ts";
import type { Report } from "../report/types.ts";
import { runGate } from "./runner.ts";
import { cfg, fakeLayer, noExec, opts, tickingClock } from "./testkit.ts";

/** The line a finding is anchored on: a file of the project is read, and one outside it is not. */

function entry(report: Report, id: string): Report["layers"][number] {
  const found = report.layers.find((layer) => layer.id === id);
  if (found === undefined) {
    throw new Error(`no ${id} in the report`);
  }
  return found;
}

describe("the line a finding is anchored on", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A project beside a file that is not in it; a finding names `file`, on its second line. */
  async function anchoredOn(file: string): Promise<{ fingerprint: string; message: string }> {
    const parent = mkdtempSync(join(tmpdir(), "wt-anchor-"));
    made.push(parent);
    const dir = join(parent, "project");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "first\n  the line in the project  \n");
    writeFileSync(join(parent, "secret.txt"), "first\nthe line outside the project\n");
    const message = "what the tool said";
    const layer = fakeLayer({
      id: "hygiene",
      findings: [{ tool: "eslint", rule: "r", verdict: "pass", message, file, line: 2 }],
    });
    const report = await runGate({
      layers: [layer],
      config: cfg(),
      options: opts(),
      cwd: dir,
      env: {},
      exec: noExec,
      outDir: join(dir, ".web-tops", "out"),
      now: tickingClock(),
    });
    const found = entry(report, "hygiene").findings[0];
    return { fingerprint: found?.fingerprint ?? "", message };
  }

  const keyed = (file: string, anchor: string): string =>
    fingerprint({ tool: "eslint", rule: "r", file, anchor, occurrence: 1 });

  it("is the line of a file in the project", async () => {
    const found = await anchoredOn("src/a.ts");
    expect(found.fingerprint).toBe(keyed("src/a.ts", anchorOf("the line in the project")));
  });

  it("is the message when the file is outside the project: it is not read", async () => {
    const found = await anchoredOn("../secret.txt");
    expect(found.fingerprint).toBe(keyed("../secret.txt", anchorOf(found.message)));
  });
});
