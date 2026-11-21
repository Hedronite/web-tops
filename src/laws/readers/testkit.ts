import { cfg, noExec } from "../../gate/testkit.ts";
import type { LawEntry, ReadInput } from "./types.ts";

/** A law as the layer takes it from the catalog. */
export function lawOf(
  id: string,
  rules: readonly { tool: string; name: string }[],
  overrides: Partial<LawEntry> = {},
): LawEntry {
  return {
    id,
    severity: "R",
    reader: "tl",
    classes: [],
    judged: true,
    rules,
    ...overrides,
  };
}

export interface InputOptions {
  readonly cwd?: string;
  readonly artifacts?: Readonly<Record<string, string>>;
  readonly tracked?: readonly string[];
  readonly held?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const DEFAULTS = { cwd: "/unused", artifacts: {}, tracked: [], held: false, env: process.env };

/** What a reader is given, with the artifacts gate 1 would have handed it. */
export function inputFor(laws: readonly LawEntry[], options: InputOptions = {}): ReadInput {
  const given = { ...DEFAULTS, ...options };
  return {
    ctx: {
      cwd: given.cwd,
      config: cfg(),
      base: "origin/main",
      enforce: "hard",
      env: given.env,
      exec: noExec,
      outDir: `${given.cwd}/.web-tops/out`,
      artifacts: new Map(Object.entries(given.artifacts)),
    },
    laws,
    tracked: given.tracked,
    eslint: () => Promise.reject(new Error("a non-lint reader asks no ESLint")),
    held: given.held,
  };
}
