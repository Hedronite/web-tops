import type { Law } from "./types.ts";

/** A section 8.2 table row: the law's cells, with a pipe in a cell escaped, and the v0.1 tick last. */
export function rowOf(law: Law): string {
  const cells = [law.id, law.title, law.severity, law.reader.text].map((cell) =>
    cell.replaceAll("|", "\\|"),
  );
  return `| ${cells.join(" | ")} |${law.judged === "v0.1" ? " ✓ |" : " |"}`;
}

/** The laws of one family, as a table's rows, in id order. */
const rowsOf = (laws: readonly Law[], family: string): string =>
  laws
    .filter((law) => law.family === family)
    .map((law) => `${rowOf(law)}\n`)
    .join("");

/** Each run of table rows (`| W-NN | ...`) under section 8.2: one table's body. */
const RUN = /^(?:\| W-\d{2,} \|[^\n]*\n)+/gmu;
/** Section 8.2: from its heading up to the heading of section 8.3. */
const SECTION = /\n### 8\.2 [\s\S]*?(?=\n### 8\.3 )/u;

export type Synced =
  | { readonly ok: true; readonly markdown: string }
  | { readonly ok: false; readonly problems: readonly string[] };

interface Tally {
  readonly problems: string[];
  readonly seen: Set<string>;
}

/** The family a table body belongs to: the family of the law its first row names. */
function familyOf(run: string, laws: readonly Law[]): string | undefined {
  const id = run.split(" ")[1];
  return laws.find((law) => law.id === id)?.family;
}

/** One table body, rewritten from the catalog; a body that names no law, or a family twice, is reported. */
function replaceRun(run: string, laws: readonly Law[], tally: Tally): string {
  const family = familyOf(run, laws);
  if (family === undefined) {
    tally.problems.push(`a table row names a law that has no file: ${String(run.split("\n")[0])}`);
    return run;
  }
  if (tally.seen.has(family)) tally.problems.push(`the ${family} table appears twice`);
  tally.seen.add(family);
  return rowsOf(laws, family);
}

/**
 * WEB_TOPS.md with the section 8.2 tables rewritten from the catalog. The table heads, the headings and the
 * prose between tables are the text's own and are kept; each body is the rows of its family. A family with
 * no table in the text, a row that names no law and a family listed twice are problems, not edits.
 */
export function syncTables(markdown: string, laws: readonly Law[]): Synced {
  const found = SECTION.exec(markdown);
  if (found === null)
    return { ok: false, problems: ["WEB_TOPS.md has no section 8.2 followed by section 8.3"] };
  const tally: Tally = { problems: [], seen: new Set() };
  const body = found[0].replace(RUN, (run) => replaceRun(run, laws, tally));
  const missing = [...new Set(laws.map((law) => law.family))].filter(
    (family) => !tally.seen.has(family),
  );
  const problems = [
    ...tally.problems,
    ...missing.map((family) => `section 8.2 has no table for the ${family} family`),
  ];
  return problems.length === 0
    ? {
        ok: true,
        markdown:
          markdown.slice(0, found.index) + body + markdown.slice(found.index + found[0].length),
      }
    : { ok: false, problems };
}
