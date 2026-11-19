import { isConditional } from "./query.ts";
import type { Filter } from "./query.ts";
import type { Judged, Law } from "./types.ts";

const SEVERITY: Readonly<Record<Law["severity"], string>> = {
  R: "a break is refuse",
  A: "a break needs an acknowledgement, or is ack-missing",
};

const JUDGED: Readonly<Record<Judged, string>> = {
  "v0.1": "ticked in section 8.2",
  m3: "gets a reader in M3",
  no: "not judged yet",
};

const ASTRO_ONLY = "only when the project depends on Astro";

/** What a filter asks for, in words: "class ts-library, required". */
function describe(filter: Filter): string {
  const parts = [
    ...(filter.cls === undefined ? [] : [`class ${filter.cls}`]),
    ...(filter.required ? ["required"] : []),
  ];
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function rowOf(law: Law, filter: Filter): string {
  const kinds = law.reader.kinds.join("+").padEnd(5);
  const when = isConditional(law, filter.cls) ? ` (${ASTRO_ONLY})` : "";
  return `${law.id}  ${law.severity}  ${kinds}  ${law.judged.padEnd(4)}  ${law.title}${when}\n`;
}

/** `laws list`: a count line, then one row per law: id, severity, reader kinds, judged, title. */
export function listText(shown: readonly Law[], total: number, filter: Filter): string {
  const head = `${String(shown.length)} of ${String(total)} laws${describe(filter)}\n`;
  return head + shown.map((law) => rowOf(law, filter)).join("");
}

const classText = (law: Law): string =>
  law.classes
    .map((name) => (isConditional(law, name) ? `${name} (${ASTRO_ONLY})` : name))
    .join(", ");

/** The rules a law maps: one line each under `rules:`, or `none` after it. */
const rulesText = (law: Law): string =>
  law.rules.length === 0
    ? " none"
    : law.rules.map((rule) => `\n  ${rule.tool}  ${rule.name}`).join("");

/** `laws explain`: every field of section 8.3, one line each, with the reader and rules spelled out. */
export function explainText(law: Law): string {
  const lines = [
    `${law.id}  ${law.title}`,
    `family:    ${law.family}`,
    `severity:  ${law.severity} (${SEVERITY[law.severity]})`,
    `classes:   ${classText(law)}`,
    `kinds:     ${law.reader.kinds.join("+")}`,
    `reader:    ${law.reader.text}`,
    `rules:${rulesText(law)}`,
    `judged:    ${law.judged} (${JUDGED[law.judged]})`,
    `rationale: ${law.rationale}`,
    `fix:       ${law.fix}`,
    ...(law.note === undefined ? [] : [`note:      ${law.note}`]),
  ];
  return `${lines.join("\n")}\n`;
}
