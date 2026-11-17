import type { Cell, Observation, Row } from "./types.ts";

const FILES = (rule: string) => ({
  bad: `fixtures/rules/${rule}.bad.tsx`,
  clean: `fixtures/rules/${rule}.clean.tsx`,
});

function fired(obs: Observation, file: string, rule: string): boolean {
  return (obs.files[file] ?? []).some((fire) => fire.rule === rule);
}

function broken(obs: Observation, file: string): boolean {
  return (obs.files[file] ?? []).some((fire) => fire.fatal);
}

function cellOf(implemented: boolean, bad: boolean, clean: boolean, fatal: boolean): Cell {
  if (!implemented) return "not-implemented";
  return fatal ? "error" : verdictOf(bad && clean);
}

function verdictOf(ok: boolean): Cell {
  return ok ? "pass" : "fail";
}

/** One rule row for one engine. `deprecated` comes from the oracle plugin, not the engine. */
export function judgeRule(
  obs: Observation,
  rule: string,
  deprecated: boolean,
  files: { readonly bad: string; readonly clean: string } = FILES(rule),
): Row {
  const implemented = obs.implemented.includes(rule);
  const bad = fired(obs, files.bad, rule);
  const clean = !fired(obs, files.clean, rule);
  const fatal = broken(obs, files.bad) || broken(obs, files.clean);
  return {
    rule,
    deprecated,
    implemented,
    fires_on_bad: bad,
    quiet_on_clean: clean,
    cell: cellOf(implemented, bad, clean, fatal),
  };
}

export function allPass(rows: readonly Row[]): boolean {
  return rows.every((row) => row.cell === "pass");
}

export function fixturePair(rule: string): readonly string[] {
  const files = FILES(rule);
  return [files.bad, files.clean];
}
