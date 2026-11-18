import { afterEach, describe, expect, it } from "vitest";
import { cleanRepos, commit, emptyRepo, git, makeRepo, write } from "../diff/test-support.ts";
import { canonicalJson } from "./canonical.ts";
import { baselineHistory } from "./history.ts";
import type { Baseline } from "./types.ts";

afterEach(cleanRepos);

const PATH = ".web-tops/baseline.json";

const BASE: Baseline = {
  report_version: "2.0.0",
  subject: { package: "p", root: "." },
  crap: { "src/a.ts::f": { complexity: 3, coverage: 1, crap: 3 } },
  coverage: { p: { lines_found: 10, lines_hit: 8 } },
  findings: { "no-console": { "src/a.ts": 2 } },
  fingerprints: [],
  census: {},
  pages: {},
};

function branched(head: Baseline | undefined): string {
  const dir = makeRepo({ [PATH]: canonicalJson(BASE), "src/a.ts": "export const a = 1;\n" });
  git(dir, "switch", "-q", "-c", "feature");
  write(dir, { "src/a.ts": "export const a = 2;\n" });
  if (head === undefined) git(dir, "rm", "-q", PATH);
  else write(dir, { [PATH]: canonicalJson(head) });
  commit(dir, "change the baseline");
  return dir;
}

const history = (dir: string): ReturnType<typeof baselineHistory> =>
  baselineHistory({ cwd: dir, baselinePath: PATH, base: "main", cap: 4 });

describe("G9c: a baseline can be tightened and never loosened, deleted or reset, across a change", () => {
  it("accepts a baseline that is the same, or tighter", async () => {
    expect(await history(branched(BASE))).toEqual({ ok: true });
    const tighter = { ...BASE, findings: { "no-console": { "src/a.ts": 1 } } };
    expect(await history(branched(tighter))).toEqual({ ok: true });
  });

  it("fails a change that raises a count, so regenerating the baseline cannot launder a rise", async () => {
    const result = await history(
      branched({ ...BASE, findings: { "no-console": { "src/a.ts": 3 } } }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("no-console");
  });

  it.each([
    ["CRAP of a function up", { crap: { "src/a.ts::f": { complexity: 3, coverage: 1, crap: 9 } } }],
    ["coverage down", { coverage: { p: { lines_found: 10, lines_hit: 2 } } }],
    [
      "a census count up",
      { census: { "v8-ignore": { count: 1, fingerprints: ["fp1:0123456789abcdef"] } } },
    ],
    [
      "a new function above the cap",
      { crap: { ...BASE.crap, "src/b.ts::g": { complexity: 9, coverage: 1, crap: 9 } } },
    ],
  ])("fails a change that has %s", async (_what, patch) => {
    expect(await history(branched({ ...BASE, ...patch }))).toMatchObject({ ok: false });
  });

  it("fails a change that deletes the baseline: deleting it is not a reset", async () => {
    const result = await history(branched(undefined));
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/gone|deleted|missing/);
  });

  it("fails a change whose baseline is not valid", async () => {
    const dir = branched(BASE);
    write(dir, { [PATH]: '{"report_version": 2}\n' });
    commit(dir, "break it");
    expect(await history(dir)).toMatchObject({ ok: false });
  });

  it("fails when the merge base's own baseline is not valid, and says so", async () => {
    const dir = makeRepo({ [PATH]: "{ not json\n", "src/a.ts": "export const a = 1;\n" });
    git(dir, "switch", "-q", "-c", "feature");
    write(dir, { [PATH]: canonicalJson(BASE) });
    commit(dir, "replace it");
    const result = await history(dir);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("at the merge base is not valid JSON");
  });

  it("accepts the first baseline: none at the merge base, so legacy findings may stay in it", async () => {
    const dir = makeRepo({ "src/a.ts": "export const a = 1;\n" });
    git(dir, "switch", "-q", "-c", "feature");
    write(dir, {
      [PATH]: canonicalJson({ ...BASE, findings: { "no-console": { "src/a.ts": 40 } } }),
    });
    commit(dir, "the first baseline");
    expect(await history(dir)).toEqual({ ok: true });
  });

  it("fails on a shallow clone, as the diff does, and when the base is missing", async () => {
    const origin = makeRepo({ [PATH]: canonicalJson(BASE) });
    write(origin, { "src/a.ts": "export const a = 1;\n" });
    commit(origin, "second");
    const clone = emptyRepo();
    git(clone, "remote", "add", "origin", `file://${origin}`);
    git(clone, "fetch", "-q", "--depth", "1", "origin", "main");
    git(clone, "switch", "-q", "-c", "work", "FETCH_HEAD");
    const shallow = await baselineHistory({
      cwd: clone,
      baselinePath: PATH,
      base: "origin/main",
      cap: 4,
    });
    expect(JSON.stringify(shallow)).toMatch(/shallow/);
    const missing = await baselineHistory({
      cwd: makeRepo({ [PATH]: canonicalJson(BASE) }),
      baselinePath: PATH,
      base: "origin/nowhere",
      cap: 4,
    });
    expect(missing).toMatchObject({ ok: false });
  });
});
