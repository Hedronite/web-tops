import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";
import { adopter, KIT } from "./test-support-probe.ts";

afterAll(cleanTemp);

/**
 * `webtops laws probe` as a user runs it: a real `bun src/cli/main.ts` process, through the production default exec
 * (`realExec`), over a project that is not the kit. QA plants on this command:
 * `bun <kit>/src/cli/main.ts laws probe --law W-11 --json`, run in a project directory.
 */
function probe(
  cwd: string,
  ...args: string[]
): { status: number | null; out: string; err: string } {
  const run = spawnSync("bun", [`${KIT}/src/cli/main.ts`, "laws", "probe", ...args], {
    cwd,
    encoding: "utf8",
  });
  return { status: run.status, out: run.stdout, err: run.stderr };
}

const off = (name: string, text: string): string =>
  name === "eslint.config.js"
    ? text.replace(
        '"@typescript-eslint/no-floating-promises": "error"',
        '"@typescript-eslint/no-floating-promises": "off"',
      )
    : text;

describe("G3c `webtops laws probe` in a real process, through the production exec", () => {
  it(
    "passes a project whose config keeps the rules, with exit 0 and the law named in the report",
    () => {
      const run = probe(adopter(), "--law", "W-11", "--json");
      expect(run.err).toBe("");
      expect(run.status).toBe(0);
      expect(run.out).toContain('"id": "W-11"');
      expect(run.out).toContain('"verdict": "pass"');
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "fails a project whose config turns one of the law's rules off: exit 1, the silent rule named",
    () => {
      const run = probe(adopter(off), "--law", "W-11");
      expect(run.status).toBe(1);
      expect(run.out).toContain("W-11");
      expect(run.out).toContain("no-floating-promises did not fire on its bad twin");
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "exits 3 when a tool is not installed in the project, saying which",
    () => {
      const run = probe(tempDir(), "--law", "W-11");
      expect(run.status).toBe(3);
      expect(run.err).toContain("eslint did not run: tool-missing");
    },
    REAL_TOOL_TIMEOUT,
  );
});
