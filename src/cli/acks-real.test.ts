import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";

/**
 * The real `webtops check` and `webtops acks`, in child processes, with the kit's own law catalog: a hard law (W-04) and
 * an id that is no law (W-99) are failures, a soft law (W-28) is not. The functions are tested by calling them, with a
 * severity of their own; this proves the wiring and the catalog, and it is not run inside a Stryker worker.
 */

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const KIT = resolve(import.meta.dirname, "../..");
const SLOW = 60_000;
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

const EXAMPLE = readFileSync(resolve(KIT, "fixtures/config/examples/ts-library.yaml"), "utf8");

const ledger = (law: string): string =>
  `version: 1\nacks:\n  - law: ${law}\n    file: src/a.ts\n    reason: Reviewed with the owner.\n    owner: web-platform\n`;

function webtops(dir: string, ...args: string[]) {
  const done = spawnSync("bun", [resolve(KIT, "src/cli/main.ts"), ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  return { code: done.status, out: done.stdout, err: done.stderr };
}

function project(files: Readonly<Record<string, string>>): string {
  const dir = tempDir();
  put(dir, "web-tops.yaml", EXAMPLE);
  for (const [name, text] of Object.entries(files)) put(dir, name, text);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["add", "-A", "-f"], { cwd: dir });
  return dir;
}

describe.skipIf(insideStryker)("webtops check reads the ack ledger", () => {
  it(
    "fails an entry for a hard law and one for an id that is no law, naming each",
    () => {
      const hard = webtops(project({ ".web-tops/acks.yaml": ledger("W-04") }), "check");
      expect(hard.code).toBe(2);
      expect(hard.err).toContain(".web-tops/acks.yaml: invalid");
      expect(hard.err).toContain("ack-not-needed: src/a.ts: W-04 is a hard law");
      const unknown = webtops(project({ ".web-tops/acks.yaml": ledger("W-99") }), "check");
      expect(unknown.code).toBe(2);
      expect(unknown.err).toContain("ack-unknown-law: src/a.ts: W-99 is not a law");
    },
    SLOW,
  );

  it(
    "fails a ledger that is not valid against the schema",
    () => {
      const done = webtops(
        project({ ".web-tops/acks.yaml": "version: 1\nacks:\n  - law: W-28\n" }),
        "check",
      );
      expect(done.code).toBe(2);
      expect(done.err).toContain("ack-ledger-unreadable: /acks/0/file");
    },
    SLOW,
  );

  it(
    "reports the survivor ledger and the ack ledger when both are bad",
    () => {
      const done = webtops(
        project({
          ".web-tops/acks.yaml": ledger("W-04"),
          ".web-tops/survivors.yaml": "version: 1\nsurvivors:\n  - key: x\n",
        }),
        "check",
      );
      expect(done.code).toBe(2);
      expect(done.err).toContain(".web-tops/survivors.yaml: invalid");
      expect(done.err).toContain(".web-tops/acks.yaml: invalid");
      expect(done.err).toContain("ack-not-needed: src/a.ts: W-04 is a hard law");
    },
    SLOW,
  );

  it(
    "passes a project whose acks.yaml is empty or only comments",
    () => {
      expect(webtops(project({ ".web-tops/acks.yaml": "" }), "check").code).toBe(0);
      expect(webtops(project({ ".web-tops/acks.yaml": "# none yet\n" }), "check").code).toBe(0);
    },
    SLOW,
  );

  it(
    "passes a project with no ledger, and one whose entry is of a soft law",
    () => {
      expect(webtops(project({}), "check").code).toBe(0);
      expect(webtops(project({ ".web-tops/acks.yaml": ledger("W-28") }), "check").code).toBe(0);
    },
    SLOW,
  );
});

describe.skipIf(insideStryker)("webtops acks, with the kit's law catalog", () => {
  it(
    "exits 1 for a comment of a hard law, and 0 for one of a soft law",
    () => {
      const hard = webtops(project({ "src/a.ts": "// webtops-ack W-04: a reason\n" }), "acks");
      expect(hard.code).toBe(1);
      expect(hard.out).toContain("src/a.ts:1  ack-not-needed  W-04 is a hard law");
      const soft = webtops(project({ "src/a.ts": "// webtops-ack W-28: a reason\n" }), "acks");
      expect(soft.code).toBe(0);
      expect(soft.out).toContain("W-28  src/a.ts:1  comment  a reason");
    },
    SLOW,
  );
});
