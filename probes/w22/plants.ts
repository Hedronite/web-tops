import { INPUT_FILE, PAGE_FILE } from "./verdict.ts";
import type { Observation, Plant, Seen } from "./types.ts";

const BAD_FILE = "fixtures/rules/alt-text.bad.tsx";

function withFires(obs: Observation, file: string, rules: readonly string[]): Observation {
  const fires = rules.map((rule) => ({ rule, fatal: false }));
  return { ...obs, files: { ...obs.files, [file]: fires } };
}

/**
 * Deliberate failures of one engine's row or claim. Each must change the verdict, and the two
 * oxlint plants show the verdict can name it only when its claims pass as well as its rows.
 */
export function plants(base: Seen): Plant[] {
  const rowFails = { ...base, fork: withFires(base.fork, BAD_FILE, []) };
  const oxInput = withFires(base.ox, INPUT_FILE, ["control-has-associated-label"]);
  const oxBoth = withFires(oxInput, PAGE_FILE, ["alt-text"]);
  return [
    { plant: "a bar row fails on the fork", seen: rowFails, expected: "none" },
    {
      plant: "the unlabeled-input claim fails on the fork",
      seen: { ...base, fork: withFires(base.fork, INPUT_FILE, []) },
      expected: "none",
    },
    {
      plant: "the Astro claim fails on the fork",
      seen: { ...base, astro: withFires(base.astro, PAGE_FILE, []) },
      expected: "none",
    },
    {
      plant: "a bar row fails on the fork and both oxlint claims pass",
      seen: { ...rowFails, ox: oxBoth },
      expected: "oxlint",
    },
    {
      plant: "a bar row fails on the fork and oxlint's Astro claim fails",
      seen: { ...rowFails, ox: oxInput },
      expected: "none",
    },
  ];
}
