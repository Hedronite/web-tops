import { readFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "vitest";
import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import { catalogLaws } from "../laws/probe/catalog.ts";
import { put, tempDir } from "../laws/probe/testkit.ts";
import type { ProbeReport } from "../laws/probe/types.ts";
import type { Io } from "./io.ts";
import { runLawsProbeCli, type ProbeDeps } from "./laws-probe.ts";

/** Helpers for the tests that run `webtops laws probe` on a project. */

export const KIT = resolve(import.meta.dirname, "../..");

export const NO_EXEC: Exec = () => Promise.reject(new Error("no tool should run"));

function deps(over: Partial<ProbeDeps>): ProbeDeps {
  return { exec: NO_EXEC, laws: catalogLaws, fixtures: join(KIT, "fixtures/laws"), ...over };
}

export async function cli(
  argv: readonly string[],
  cwd: string,
  over: Partial<ProbeDeps> = {},
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t), cwd, env: process.env };
  const code = await runLawsProbeCli(argv, io, deps(over));
  return { code, out: out.join(""), err: err.join("") };
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
        "stylelint.config.js": fromKit("config/templates/stylelint.config.js.template"),
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

/** The probe's JSON report on a project, with the exit code. */
export async function probeOf(
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

export const messages = (report: ProbeReport): string[] =>
  report.laws.flatMap((law) => law.failures.map((failure) => failure.message));

export const verdicts = (report: ProbeReport): string[] =>
  report.laws.map((law) => `${law.id} ${law.verdict}`);

export const failing = (report: ProbeReport): string[] =>
  verdicts(report).filter((line) => line.endsWith("fail"));
