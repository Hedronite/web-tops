import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanRepos, commit, git, makeRepo, write } from "../diff/test-support.ts";
import { canonicalJson } from "./canonical.ts";
import { projectBaseline } from "./project.ts";
import { validateReport } from "../config/report.ts";
import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import { writeBaseline } from "./write.ts";

afterEach(cleanRepos);

const source: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../fixtures/report/shape/with-metrics.json"), "utf8"),
);

const BASELINE = ".web-tops/baseline.json";
const REPORT = ".web-tops/report.json";

const objectOf = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? { ...value } : {};

/** A report that passed (an advisory run, which keeps its findings and fails nothing), made at `sha`. */
function passing(sha: string, patch: Record<string, unknown> = {}): string {
  const base = objectOf(source);
  const run = { ...objectOf(base["run"]), sha };
  const edited = {
    ...base,
    enforce: "advisory",
    enforced: false,
    passed: true,
    exit_code: 0,
    crap_scope: "all",
    run,
    ...patch,
  };
  return `${JSON.stringify(edited, null, 2)}\n`;
}

function repoWithReport(patch: Record<string, unknown> = {}): { dir: string; sha: string } {
  const dir = makeRepo({
    "src/a.ts": "export const a = 1;\n",
    ".gitignore": ".web-tops/report.json\n",
  });
  const sha = git(dir, "rev-parse", "HEAD");
  write(dir, { [REPORT]: passing(sha, patch) });
  return { dir, sha };
}

const run = (dir: string): ReturnType<typeof writeBaseline> =>
  writeBaseline({ cwd: dir, reportPath: REPORT, baselinePath: BASELINE });

describe("G9a: webtops baseline is the only writer, from a passing report on a clean tree", () => {
  it("writes the projection of the report in canonical form, and writing again changes nothing", async () => {
    const { dir } = repoWithReport();
    const result = await run(dir);
    expect(result).toMatchObject({ ok: true });
    const text = readFileSync(join(dir, BASELINE), "utf8");
    const report = validateReport(JSON.parse(passing("0".repeat(40))));
    expect(report.ok && text === canonicalJson(projectBaseline(report.value))).toBe(true);
    expect((await run(dir)).ok).toBe(true);
    expect(readFileSync(join(dir, BASELINE), "utf8")).toBe(text);
  });

  it("makes the directory, and leaves .web-tops output untracked beside it without calling the tree dirty", async () => {
    const { dir } = repoWithReport();
    write(dir, { ".web-tops/out/tests/vitest.json": "{}\n" });
    expect((await run(dir)).ok).toBe(true);
    expect(existsSync(join(dir, BASELINE))).toBe(true);
  });

  it.each([
    [
      "no report",
      (dir: string) => {
        write(dir, { [REPORT]: "" });
      },
      /no report|not a report|JSON/,
    ],
    [
      "a report that is not valid",
      (dir: string) => {
        write(dir, { [REPORT]: '{"protocol": "0.3.0"}\n' });
      },
      /not a valid report|invalid/,
    ],
  ])("refuses with %s", async (_what, break_, reason) => {
    const { dir } = repoWithReport();
    break_(dir);
    const result = await run(dir);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(reason);
    expect(existsSync(join(dir, BASELINE))).toBe(false);
  });

  it("takes a first baseline from a run that did not pass if it failed only on what a baseline holds (G9-2)", async () => {
    const { dir } = repoWithReport({ passed: false, exit_code: 1 });
    expect(await run(dir)).toMatchObject({ ok: true });
  });

  it("refuses a run that did not pass on a layer a baseline does not hold, such as the tests", async () => {
    const layers = objectOf(source)["layers"];
    const list = Array.isArray(layers) ? layers : [];
    const broken = list.map((layer: unknown) =>
      objectOf(layer)["id"] === "tests"
        ? {
            ...objectOf(layer),
            verdict: "fail",
            findings: [
              {
                tool: "vitest",
                rule: "test-failed",
                law: null,
                verdict: "fail",
                message: "x",
                file: "src/a.test.ts",
                line: 1,
                fingerprint: "fp1:0123456789abcdef",
              },
            ],
          }
        : layer,
    );
    const { dir } = repoWithReport({
      passed: false,
      exit_code: 1,
      layers: broken,
      counts: { in_range: 7, ran: 7, failed: 2, not_evaluated: 0, required_not_evaluated: 0 },
    });
    expect(JSON.stringify(await run(dir))).toContain(
      "what failed is not something a first baseline holds: tests is fail (test-failed)",
    );
  });

  it("refuses a first baseline from a run whose CRAP could not read a file, though the finding has a file (G9-5)", async () => {
    const layers = objectOf(source)["layers"];
    const list = Array.isArray(layers) ? layers : [];
    const broken = list.map((layer: unknown) =>
      objectOf(layer)["id"] === "crap"
        ? {
            ...objectOf(layer),
            verdict: "fail",
            findings: [
              {
                tool: "webtops",
                rule: "complexity-error",
                law: null,
                verdict: "fail",
                message: "src/a.ts does not parse",
                file: "src/a.ts",
                line: 1,
                fingerprint: "fp1:0123456789abcdef",
              },
            ],
          }
        : layer,
    );
    const { dir } = repoWithReport({
      passed: false,
      exit_code: 1,
      layers: broken,
      counts: { in_range: 7, ran: 7, failed: 2, not_evaluated: 0, required_not_evaluated: 0 },
    });
    const text = JSON.stringify(await run(dir));
    expect(text).toContain("crap has complexity-error, which a baseline does not hold");
    expect(existsSync(join(dir, BASELINE))).toBe(false);
  });

  it("names the uncommitted files in its refusal, and says how many more there are (G9-7)", async () => {
    const one = repoWithReport();
    write(one.dir, { "src/a.ts": "export const a = 3;\n", "src/new.ts": "export const n = 1;\n" });
    const text = JSON.stringify(await run(one.dir));
    expect(text).toContain("uncommitted changes (2): src/a.ts, src/new.ts;");
    const many = repoWithReport();
    const files = Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((n) => [`src/n${String(n)}.ts`, "export {};\n"]),
    );
    write(many.dir, files);
    expect(JSON.stringify(await run(many.dir))).toContain(
      "src/n1.ts, src/n2.ts, src/n3.ts, src/n4.ts, src/n5.ts and 2 more;",
    );
  });

  it("once a baseline exists, accepts only a passing report (G9-2)", async () => {
    const { dir } = repoWithReport();
    expect((await run(dir)).ok).toBe(true);
    commit(dir, "the first baseline");
    write(dir, {
      [REPORT]: passing(git(dir, "rev-parse", "HEAD"), { passed: false, exit_code: 1 }),
    });
    expect(JSON.stringify(await run(dir))).toContain(
      "once a baseline exists only a passing report can replace it",
    );
  });

  it("refuses a report whose CRAP judged only the diff, naming --all (G9-3)", async () => {
    for (const scope of ["diff", undefined]) {
      const { dir } = repoWithReport({ crap_scope: scope });
      const text = JSON.stringify(await run(dir));
      expect(text).toContain("--all");
      expect(existsSync(join(dir, BASELINE))).toBe(false);
    }
  });

  it("refuses a report made for another commit", async () => {
    const { dir } = repoWithReport();
    write(dir, { "src/a.ts": "export const a = 2;\n" });
    commit(dir, "move on");
    expect(JSON.stringify(await run(dir))).toMatch(/commit|sha/i);
  });

  it("refuses when a tracked file has uncommitted changes, or an untracked file is lying about", async () => {
    const tracked = repoWithReport();
    write(tracked.dir, { "src/a.ts": "export const a = 3;\n" });
    expect(JSON.stringify(await run(tracked.dir))).toMatch(/uncommitted|clean/);
    const untracked = repoWithReport();
    write(untracked.dir, { "src/new.ts": "export const n = 1;\n" });
    expect(JSON.stringify(await run(untracked.dir))).toMatch(/uncommitted|clean/);
  });

  it("does not call the baseline's own uncommitted change a dirty tree, even as the first line of the status (G9-7)", async () => {
    const { dir } = repoWithReport();
    write(dir, { [BASELINE]: "{}\n" });
    commit(dir, "a baseline to change");
    const sha = git(dir, "rev-parse", "HEAD");
    write(dir, { [REPORT]: passing(sha), [BASELINE]: canonicalJson({ changed: true }) });
    expect(JSON.stringify(await run(dir))).not.toContain("uncommitted");
  });

  it("refuses a baseline that would be looser than the one already written", async () => {
    const { dir } = repoWithReport();
    const report = validateReport(JSON.parse(passing("0".repeat(40))));
    if (!report.ok) throw new Error("fixture");
    const tighter = {
      ...projectBaseline(report.value),
      findings: { "no-console": { "src/wire.ts": 1 } },
    };
    write(dir, { [BASELINE]: canonicalJson(tighter) });
    commit(dir, "a tighter baseline");
    const sha = git(dir, "rev-parse", "HEAD");
    write(dir, { [REPORT]: passing(sha) });
    const result = await run(dir);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/looser|above its baseline/);
    expect(readFileSync(join(dir, BASELINE), "utf8")).toBe(canonicalJson(tighter));
  });

  it("refuses to replace a baseline that is not valid", async () => {
    const { dir } = repoWithReport();
    write(dir, { [BASELINE]: "{}\n" });
    commit(dir, "a broken baseline");
    write(dir, { [REPORT]: passing(git(dir, "rev-parse", "HEAD")) });
    expect(JSON.stringify(await run(dir))).toMatch(/not a valid baseline/);
  });

  it("refuses when git cannot say what the work tree holds", async () => {
    const { dir } = repoWithReport();
    const broken: Exec = (command, args, options) =>
      args[0] === "status"
        ? Promise.resolve({ code: 128, stdout: "", stderr: "fatal: boom" })
        : realExec(command, args, options);
    const result = await writeBaseline({
      cwd: dir,
      reportPath: REPORT,
      baselinePath: BASELINE,
      exec: broken,
    });
    expect(JSON.stringify(result)).toContain("cannot read the work tree: fatal: boom");
  });

  it("refuses a class with no launch profile", async () => {
    const { dir } = repoWithReport({ class: "cli" });
    expect(JSON.stringify(await run(dir))).toContain("has no launch profile");
  });
});
