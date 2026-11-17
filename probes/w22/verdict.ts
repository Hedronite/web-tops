import { allPass } from "./judge.ts";
import type { EngineRows } from "./table.ts";
import type { Claim, Observation, Row, Seen } from "./types.ts";

export const INPUT_FILE = "fixtures/claims/unlabeled-input.tsx";
export const PAGE_FILE = "fixtures/claims/astro-claim.astro";
const INPUT = "unlabeled <input type=text> fires";
const ASTRO = "Astro a11y fires on .astro";
const CLAIMS_PER_CANDIDATE = 2;

/** A rule is in the bar unless it is deprecated upstream. */
export function inBar(row: Row): boolean {
  return !row.deprecated;
}

function firedRules(obs: Observation, file: string): string[] {
  const rules = (obs.files[file] ?? []).flatMap((fire) => (fire.rule === null ? [] : [fire.rule]));
  return [...new Set(rules)].sort();
}

/** A claim passes when at least one a11y rule fires on its fixture; nothing fired is a fail. */
function claim(name: string, candidate: string, via: string, obs: Observation, file: string) {
  const fired = firedRules(obs, file);
  return { claim: name, candidate, via, fired, pass: fired.length > 0 };
}

export function claimsOf(seen: Seen): Claim[] {
  return [
    claim(INPUT, "jsx-a11y-x", "ESLint 10 with the fork", seen.fork, INPUT_FILE),
    claim(INPUT, "oxlint", "oxlint", seen.ox, INPUT_FILE),
    claim(INPUT, "control", "ESLint 9.39 with jsx-a11y 6.10.2", seen.control, INPUT_FILE),
    claim(
      ASTRO,
      "jsx-a11y-x",
      "eslint-plugin-astro on ESLint 10, via the fork",
      seen.astro,
      PAGE_FILE,
    ),
    claim(ASTRO, "oxlint", "frontmatter script only", seen.ox, PAGE_FILE),
  ];
}

/** Every bar row passes and both of the candidate's claim rows pass. */
export function qualifies(engine: EngineRows, claims: readonly Claim[]): boolean {
  const own = claims.filter((c) => c.candidate === engine.label);
  return (
    allPass(engine.rows.filter(inBar)) &&
    own.length === CLAIMS_PER_CANDIDATE &&
    own.every((c) => c.pass)
  );
}

/** The first candidate that qualifies, in the order given, or none. */
export function readerOf(candidates: readonly EngineRows[], claims: readonly Claim[]): string {
  return candidates.find((engine) => qualifies(engine, claims))?.label ?? "none";
}
