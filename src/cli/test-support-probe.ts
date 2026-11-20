import { readFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "vitest";
import { spawnSync } from "node:child_process";
import type { Exec } from "../gate/types.ts";
import { kitProbeLaws, put, tempDir } from "../laws/probe/testkit.ts";
import type { ProbeLaw, ProbeReport } from "../laws/probe/types.ts";
import type { Io } from "./io.ts";
import { runLawsProbeCli, type ProbeDeps } from "./laws-probe.ts";

/** Helpers for the tests that run `webtops laws probe` on a project. */

export const KIT = resolve(import.meta.dirname, "../..");

/**
 * `webtops laws probe` as a real process: `bun src/cli/main.ts laws probe`, through the production exec, in a directory.
 * The tests that run the real ESLint, tsc and Stylelint go through it, so they prove the command end to end and the
 * mutation run does not count them as covering the probe's own code, which the fake-linter tests judge.
 */
export function probeProcess(
  cwd: string,
  ...argv: string[]
): { readonly code: number; readonly out: string; readonly err: string } {
  const run = spawnSync("bun", [join(KIT, "src/cli/main.ts"), "laws", "probe", ...argv], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  return { code: statusOf(run.status), out: run.stdout, err: run.stderr };
}

/** The exit code of a process that was spawned, or -1 for one a signal ended before it gave one. */
export const statusOf = (status: number | null): number => status ?? -1;

export const NO_EXEC: Exec = () => Promise.reject(new Error("no tool should run"));

/** The kit's laws for a test that names none, read by a process of its own the first time and kept. */
let kept: readonly ProbeLaw[] | undefined;
const kitLaws = (): readonly ProbeLaw[] => (kept ??= kitProbeLaws());

function deps(over: Partial<ProbeDeps>): ProbeDeps {
  return { exec: NO_EXEC, laws: kitLaws, fixtures: join(KIT, "fixtures/laws"), ...over };
}

export async function cli(
  argv: readonly string[],
  cwd: string,
  over: Partial<ProbeDeps> = {},
): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
    env: process.env,
  };
  const code = await runLawsProbeCli(argv, io, deps(over));
  return { code, out, err };
}

type Edit = (name: string, text: string) => string;

const unchanged: Edit = (_name, text) => text;

/** A project's own ESLint config for a UI class: the kit's, and the a11y rules W-22 maps for `.tsx`. */
const UI_ESLINT = `import kit from "./kit.config.js";
import a11y from "eslint-plugin-jsx-a11y-x";

export default [
  ...kit,
  {
    files: ["**/*.tsx"],
    plugins: { "jsx-a11y-x": a11y },
    rules: {
      "jsx-a11y-x/alt-text": "error",
      "jsx-a11y-x/click-events-have-key-events": "error",
      "jsx-a11y-x/no-static-element-interactions": "error",
      "jsx-a11y-x/label-has-associated-control": "error",
      "jsx-a11y-x/anchor-is-valid": "error",
    },
  },
];
`;

const fromKit = (name: string): string => readFileSync(join(KIT, name), "utf8");

function files(ui: boolean): Record<string, string> {
  const base = { "tsconfig.json": fromKit("tsconfig.json") };
  return ui
    ? {
        ...base,
        "kit.config.js": fromKit("eslint.config.js"),
        "eslint.config.js": UI_ESLINT,
        // The preset is a plain object: an adopter that has no `web-tops` package to import keeps a copy of it.
        "stylelint.config.js": fromKit("src/presets/stylelint.js"),
      }
    : { ...base, "eslint.config.js": fromKit("eslint.config.js") };
}

/**
 * A project that is not the kit: its own copy of the kit's config, and the kit's tools through a symlink. `ui` gives it
 * the rules of a UI class too (the a11y rules, and a Stylelint config). `edit` rewrites a file as it is written.
 */
export function adopter(edit: Edit = unchanged, ui = false): string {
  const dir = tempDir();
  symlinkSync(join(KIT, "node_modules"), join(dir, "node_modules"));
  const written = Object.entries(files(ui)).map(
    ([name, text]) => [name, edit(name, text)] as const,
  );
  put(dir, { ...Object.fromEntries(written), "package.json": '{ "type": "module" }\n' });
  return dir;
}

function isReport(value: unknown): value is ProbeReport {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "laws"));
}

/** What `webtops laws probe --json` printed, read: it printed nothing to stderr, and its JSON is a report. */
export function probeFrom(run: {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}): {
  code: number;
  report: ProbeReport;
} {
  expect(run.err).toBe("");
  const report: unknown = JSON.parse(run.out);
  if (!isReport(report)) {
    throw new Error("the probe printed no report");
  }
  return { code: run.code, report };
}

/** The probe's JSON report on a project, with the exit code, from a real process. */
export function probeOf(
  cwd: string,
  ...argv: string[]
): Promise<{ code: number; report: ProbeReport }> {
  return Promise.resolve(probeFrom(probeProcess(cwd, "--json", ...argv)));
}

export const messages = (report: ProbeReport): string[] =>
  report.laws.flatMap((law) => law.failures.map((failure) => failure.message));

export const verdicts = (report: ProbeReport): string[] =>
  report.laws.map((law) => `${law.id} ${law.verdict}`);

export const failing = (report: ProbeReport): string[] =>
  verdicts(report).filter((line) => line.endsWith("fail"));
