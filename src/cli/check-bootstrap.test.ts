import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson } from "../baseline/canonical.ts";
import { EMPTY_BASELINE } from "../baseline/test-support.ts";
import { cleanRepos, commit, git, makeRepo, write } from "../diff/test-support.ts";
import { runCheckCli } from "./check.ts";
import type { Io } from "./io.ts";

afterEach(cleanRepos);

const BASELINE = ".web-tops/baseline.json";

const YAML = `protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: ts-library\nenforce: ratchet\nbaseline: ${BASELINE}\ngates:\n  mutation:\n    base: main\n`;

function streams(cwd: string): { io: Io; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
      cwd,
      env: {},
    },
    out: () => out,
    err: () => err,
  };
}

describe("G9-2: check allows ratchet with no baseline only in the bootstrap state, and names the way out", () => {
  it("passes, saying there is no baseline yet and how to take one", async () => {
    const dir = makeRepo({ "web-tops.yaml": YAML, "src/a.ts": "export const a = 1;\n" });
    git(dir, "switch", "-q", "-c", "adopt");
    const run = streams(dir);
    expect(await runCheckCli([], run.io)).toBe(0);
    expect(run.out()).toContain(
      "enforce ratchet; no baseline yet: run webtops gate --all --keep-going, then webtops baseline",
    );
  });

  it("says nothing of it once the baseline is there", async () => {
    const dir = makeRepo({
      "web-tops.yaml": YAML,
      [BASELINE]: canonicalJson(EMPTY_BASELINE),
      "src/a.ts": "export const a = 1;\n",
    });
    const run = streams(dir);
    expect(await runCheckCli([], run.io)).toBe(0);
    expect(run.out()).not.toContain("no baseline yet");
  });

  it("is not a way to reset: a baseline the merge base had, deleted in the change, still fails", async () => {
    const dir = makeRepo({
      "web-tops.yaml": YAML,
      [BASELINE]: canonicalJson(EMPTY_BASELINE),
      "src/a.ts": "export const a = 1;\n",
    });
    git(dir, "switch", "-q", "-c", "feature");
    git(dir, "rm", "-q", BASELINE);
    commit(dir, "delete the baseline");
    const run = streams(dir);
    expect(await runCheckCli([], run.io)).toBe(2);
    expect(run.err()).toContain("/baseline: the baseline is gone or invalid");
  });

  it("is not a way to reset: a deleted baseline that is not yet committed fails too", async () => {
    const dir = makeRepo({
      "web-tops.yaml": YAML,
      [BASELINE]: canonicalJson(EMPTY_BASELINE),
      "src/a.ts": "export const a = 1;\n",
    });
    write(dir, { "src/b.ts": "export const b = 1;\n" });
    git(dir, "rm", "-q", "-f", BASELINE);
    const run = streams(dir);
    expect(await runCheckCli([], run.io)).toBe(2);
  });
});
