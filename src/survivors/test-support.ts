import type { SurvivorKey } from "./key.ts";
import type { LedgerEntry } from "./types.ts";

export const CLAMP_KEY: SurvivorKey = {
  file: "src/clamp.ts",
  function: "src/clamp.ts::clamp",
  mutator: "EqualityOperator",
  original: "n < low",
  replacement: "n <= low",
  occurrence: 1,
};

export const SUM_KEY: SurvivorKey = {
  file: "src/total.ts",
  function: "src/total.ts::total",
  mutator: "AssignmentOperator",
  original: "sum += x",
  replacement: "sum -= x",
  occurrence: 1,
};

export const entry = (key: SurvivorKey, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  key,
  reason: "boundary is equivalent here",
  owner: "web-platform",
  expires: undefined,
  ...extra,
});

/** One ledger entry as the file writes it, two spaces in, so tests can build a file from parts. */
export function entryYaml(
  key: SurvivorKey,
  more: readonly string[] = ["reason: because", "owner: someone"],
): string {
  const lines = [
    `file: ${key.file}`,
    `function: ${key.function}`,
    `mutator: ${key.mutator}`,
    `original: ${JSON.stringify(key.original)}`,
    `replacement: ${JSON.stringify(key.replacement)}`,
    `occurrence: ${String(key.occurrence)}`,
    ...more,
  ];
  return lines.map((line, index) => (index === 0 ? `  - ${line}` : `    ${line}`)).join("\n");
}

export const ledgerYaml = (...entries: readonly string[]): string =>
  `version: 1\nsurvivors:\n${entries.join("\n")}\n`;

/** A gate report with a mutation layer whose findings carry these survivors (report_version 2.1.0 shape). */
export const reportWith = (...survivors: readonly SurvivorKey[]): string =>
  JSON.stringify({
    layers: [
      { id: "tests", findings: [] },
      { id: "mutation", findings: survivors.map((survivor) => ({ rule: "survivor", survivor })) },
    ],
  });
