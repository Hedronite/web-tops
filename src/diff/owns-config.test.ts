import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ownsConfigAt } from "./scope.ts";

/** An example is left out of the diff when its own folder holds `web-tops.yaml` (WEB_TOPS.md section 6.4). */

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(files: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-owns-"));
  made.push(dir);
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "x\n");
  }
  return dir;
}

describe("ownsConfigAt", () => {
  it("is true for an examples folder that holds its own web-tops.yaml, and false for one that does not", () => {
    const owns = ownsConfigAt(
      project(["examples/gates/web-tops.yaml", "examples/plain/src/a.ts", "web-tops.yaml"]),
    );
    expect([owns("examples/gates"), owns("examples/plain"), owns("examples/missing")]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("reads the config of the folder itself, not the root's", () => {
    expect(ownsConfigAt(project(["web-tops.yaml"]))("examples/gates")).toBe(false);
  });
});
