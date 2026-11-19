import { cpSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realExec } from "../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import type { Exec } from "../gate/types.ts";
import { interimLaws } from "../laws/probe/catalog.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import type { LawSource, ProbeReport } from "../laws/probe/types.ts";
import type { Io } from "./io.ts";
import { runLawsProbeCli, type ProbeDeps } from "./laws-probe.ts";

afterAll(cleanTemp);

const KIT = resolve(import.meta.dirname, "../..");

interface Captured {
  readonly io: Io;
  readonly out: string[];
  readonly err: string[];
}

function capture(cwd: string): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t), cwd, env: process.env };
  return { io, out, err };
}

const NO_EXEC: Exec = () => Promise.reject(new Error("no tool should run"));

function deps(over: Partial<ProbeDeps> = {}): ProbeDeps {
  return { exec: NO_EXEC, laws: interimLaws, fixtures: join(KIT, "fixtures/laws"), ...over };
}

async function cli(
  argv: readonly string[],
  cwd: string,
  over: Partial<ProbeDeps> = {},
): Promise<{ code: number; out: string; err: string }> {
  const seen = capture(cwd);
  const code = await runLawsProbeCli(argv, seen.io, deps(over));
  return { code, out: seen.out.join(""), err: seen.err.join("") };
}

describe("G3b `laws probe`: arguments and problems", () => {
  it("rejects an argument it does not know, and a flag with no value, with the usage", async () => {
    const unknown = await cli(["--wat"], tempDir());
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("webtops laws probe:");
    expect(unknown.err).toContain("usage: webtops laws probe [--law W-NN]");
    expect((await cli(["--law"], tempDir())).code).toBe(2);
    expect((await cli(["stray"], tempDir())).code).toBe(2);
  });

  it("names a law the catalog does not have", async () => {
    const result = await cli(["--law", "W-98"], tempDir());
    expect(result).toMatchObject({ code: 2, err: "webtops laws probe: no law W-98 to probe\n" });
  });

  it("says so when the catalog has no law at all", async () => {
    const empty: LawSource = () => [];
    const result = await cli([], tempDir(), { laws: empty });
    expect(result).toMatchObject({ code: 2, err: "webtops laws probe: no law to probe\n" });
  });

  it("exits with the problem's code and message when a tool cannot run", async () => {
    const result = await cli(["--law", "W-01"], tempDir());
    expect(result.code).toBe(3);
    expect(result.err).toBe(
      "webtops laws probe: eslint did not run: tool-missing. eslint is not installed in node_modules\n",
    );
    expect(result.out).toBe("");
  });
});

/** A project that is not the kit: its own copy of the kit's config, and the kit's tools through a symlink. */
function adopter(edit: (name: string, text: string) => string = (_name, text) => text): string {
  const dir = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(dir, "node_modules"));
  for (const name of ["eslint.config.js", "tsconfig.json"]) {
    writeFileSync(join(dir, name), edit(name, readFileSync(join(KIT, name), "utf8")));
  }
  put(dir, { "package.json": '{ "type": "module" }\n', "src/index.ts": "export const a = 1;\n" });
  return dir;
}

function isReport(value: unknown): value is ProbeReport {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "laws"));
}

/** The probe's JSON report on a project, with the exit code. */
async function probeOf(
  cwd: string,
  ...argv: string[]
): Promise<{ code: number; report: ProbeReport }> {
  const run = await cli(["--json", ...argv], cwd, { exec: realExec });
  expect(run.err).toBe("");
  const report: unknown = JSON.parse(run.out);
  if (!isReport(report)) {
    throw new Error("the probe printed no report");
  }
  return { code: run.code, report };
}

const messages = (report: ProbeReport): string[] =>
  report.laws.flatMap((law) => law.failures.map((failure) => failure.message));

const verdicts = (report: ProbeReport): string[] =>
  report.laws.map((law) => `${law.id} ${law.verdict}`);

describe("G3b `laws probe` on a project's own config", () => {
  let kitLike: Awaited<ReturnType<typeof probeOf>>;
  let kitText: string;
  beforeAll(async () => {
    const dir = adopter();
    kitLike = await probeOf(dir);
    kitText = (await cli([], dir, { exec: realExec })).out;
  }, REAL_TOOL_TIMEOUT);

  it("passes every law under a config that is the kit's, with no finding left unexplained", () => {
    expect(kitLike.code).toBe(0);
    expect(verdicts(kitLike.report)).toEqual(interimLaws().map((law) => `${law.id} pass`));
    expect(kitLike.report.laws.flatMap((law) => law.unrelated)).toEqual([]);
  });

  it("prints a line for each law and how many pass, in text", () => {
    expect(kitText).toContain("W-01  pass\n");
    expect(kitText).toContain("W-35  pass\n");
    expect(kitText.endsWith("12 of 12 laws probed pass\n")).toBe(true);
  });

  it(
    "an adopter config that does not enable a rule fails the law that maps it, and only that law",
    async () => {
      const off = (name: string, text: string): string =>
        name === "eslint.config.js"
          ? text.replace(
              '"@typescript-eslint/no-floating-promises": "error"',
              '"@typescript-eslint/no-floating-promises": "off"',
            )
          : text;
      const result = await probeOf(adopter(off));
      expect(result.code).toBe(1);
      expect(verdicts(result.report).filter((line) => line.endsWith("fail"))).toEqual([
        "W-11 fail",
      ]);
      expect(messages(result.report)).toEqual([
        "W-11/bad/promises.ts:6 stayed quiet: no-floating-promises did not fire on its bad twin",
      ]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "an adopter tsconfig that turns a flag off fails the laws that prove it",
    async () => {
      const loose = (name: string, text: string): string =>
        name === "tsconfig.json"
          ? text.replace('"erasableSyntaxOnly": true', '"erasableSyntaxOnly": false')
          : text;
      const result = await probeOf(adopter(loose));
      const failed = verdicts(result.report).filter((line) => line.endsWith("fail"));
      expect(failed).toEqual(["W-02 fail", "W-04 fail", "W-05 fail"]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "--law probes one law, --config names the ESLint config, --tsconfig the compiler's, --fixtures the twins",
    async () => {
      const dir = adopter();
      cpSync(join(dir, "eslint.config.js"), join(dir, "other.config.js"));
      cpSync(join(dir, "tsconfig.json"), join(dir, "other.tsconfig.json"));
      const twins = tempDir();
      cpSync(join(KIT, "fixtures/laws/W-14"), join(twins, "W-14"), { recursive: true });
      const args = [
        "--law",
        "W-14",
        "--config",
        "other.config.js",
        "--tsconfig",
        "other.tsconfig.json",
        "--fixtures",
        twins,
      ];
      const result = await probeOf(dir, ...args);
      expect(verdicts(result.report)).toEqual(["W-14 pass"]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "a clean twin that a rule flags fails the law as noisy, and a bad twin it does not flag as silent",
    async () => {
      const twins = tempDir();
      put(twins, {
        "W-14/bad/throws.ts":
          'export function fail(): never {\n  throw new Error("x"); // expect: only-throw-error\n}\n',
        "W-14/clean/throws.ts": 'export function fail(): never {\n  throw "x";\n}\n',
      });
      const result = await probeOf(adopter(), "--law", "W-14", "--fixtures", twins);
      expect(result.code).toBe(1);
      expect(messages(result.report)).toEqual([
        "W-14/bad/throws.ts:2 stayed quiet: only-throw-error did not fire on its bad twin",
        "W-14/clean/throws.ts:2 fired @typescript-eslint/only-throw-error on its clean twin",
        "W-14 maps prefer-promise-reject-errors, and no bad twin proves it fires",
      ]);
    },
    REAL_TOOL_TIMEOUT,
  );

  it(
    "takes the ESLint config from web-tops.yaml when the project names one",
    async () => {
      const dir = adopter();
      cpSync(join(dir, "eslint.config.js"), join(dir, "named.config.js"));
      writeFileSync(
        join(dir, "eslint.config.js"),
        "export default [{ files: ['**/*.nothing'], rules: {} }];\n",
      );
      put(dir, {
        "web-tops.yaml": "gates:\n  hygiene:\n    eslint: { config: named.config.js }\n",
      });
      const result = await probeOf(dir, "--law", "W-14");
      expect(verdicts(result.report)).toEqual(["W-14 pass"]);
    },
    REAL_TOOL_TIMEOUT,
  );
});
