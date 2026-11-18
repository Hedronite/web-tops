import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson } from "../baseline/canonical.ts";
import type { Baseline } from "../baseline/types.ts";
import { cleanRepos, commit, emptyRepo, git, makeRepo, write } from "../diff/test-support.ts";
import { runCheckCli } from "./check.ts";
import type { Io } from "./io.ts";

afterEach(cleanRepos);

const BASELINE = ".web-tops/baseline.json";

const BASE: Baseline = {
  report_version: "2.0.0",
  subject: { package: "p", root: "." },
  crap: {},
  coverage: {},
  findings: { "no-console": { "src/a.ts": 2 } },
  fingerprints: [],
  census: {},
  pages: {},
};

const YAML = (enforce: string): string =>
  `protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: ts-library\nenforce: ${enforce}\nbaseline: ${BASELINE}\ngates:\n  mutation:\n    base: main\n`;

function branched(head: Baseline, enforce = "ratchet"): string {
  const dir = makeRepo({
    "web-tops.yaml": YAML(enforce),
    [BASELINE]: canonicalJson(BASE),
    "src/a.ts": "export const a = 1;\n",
  });
  git(dir, "switch", "-q", "-c", "feature");
  write(dir, { [BASELINE]: canonicalJson(head), "src/a.ts": "export const a = 2;\n" });
  commit(dir, "change");
  return dir;
}

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

describe("G9c: check under ratchet holds the baseline across the change", () => {
  it("passes when the baseline is the same, or tighter, than the merge base's", async () => {
    const same = streams(branched(BASE));
    expect(await runCheckCli([], same.io)).toBe(0);
    const tighter = streams(branched({ ...BASE, findings: { "no-console": { "src/a.ts": 1 } } }));
    expect(await runCheckCli([], tighter.io)).toBe(0);
  });

  it("exits 2 at /baseline when the change raises a count, naming what rose", async () => {
    const raised = streams(branched({ ...BASE, findings: { "no-console": { "src/a.ts": 3 } } }));
    expect(await runCheckCli([], raised.io)).toBe(2);
    expect(raised.out()).toBe("");
    expect(raised.err()).toContain("  /baseline: the baseline rose: no-console in src/a.ts");
  });

  it("exits 2 on a shallow clone, as the diff does", async () => {
    const origin = branched(BASE);
    const clone = emptyRepo();
    git(clone, "remote", "add", "origin", `file://${origin}`);
    git(clone, "fetch", "-q", "--depth", "1", "origin", "feature");
    git(clone, "switch", "-q", "-c", "work", "FETCH_HEAD");
    git(clone, "branch", "main", "FETCH_HEAD");
    const shallow = streams(clone);
    expect(await runCheckCli([], shallow.io)).toBe(2);
    expect(shallow.err()).toMatch(/\/baseline: .*shallow/);
  });

  it("does not ask for a merge base under hard or advisory, which read no baseline", async () => {
    const hard = streams(
      branched({ ...BASE, findings: { "no-console": { "src/a.ts": 99 } } }, "hard"),
    );
    expect(await runCheckCli([], hard.io)).toBe(0);
  });
});
