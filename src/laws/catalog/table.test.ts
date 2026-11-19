import { describe, expect, it } from "vitest";
import { rowOf, syncTables } from "./table.ts";
import { join, resolve } from "node:path";
import { loadCatalog } from "./load.ts";
import type { Law } from "./types.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

/** The kit's own catalog, loaded: a test that needs the real laws fails here if the catalog is invalid. */
function realLaws(): readonly Law[] {
  const loaded = loadCatalog(join(ROOT, "laws"));
  if (!loaded.ok) throw new Error(loaded.problems.map((found) => found.message).join("; "));
  return loaded.laws;
}

const laws = realLaws();
const law = (id: string): Law => {
  const found = laws.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};

const head = "| ID | Law | Sev | Reader | v0.1 |\n|---|---|---|---|---|\n";

/** A document with section 8.2 around the given tables (family heading, head, rows), then section 8.3. */
const doc = (...tables: string[]): string =>
  `# Title\n\n### 8.1 Model\n\ntext\n\n### 8.2 Law catalog\n\n${tables.join("\n")}\n### 8.3 Law metadata\n\nafter\n`;

const table = (heading: string, ...ids: string[]): string =>
  `**${heading}**\n\n${head}${ids.map((id) => `${rowOf(law(id))}\n`).join("")}\n`;

const small: Law[] = laws.filter((candidate) =>
  ["W-01", "W-02", "W-03", "W-10"].includes(candidate.id),
);
const types = (): string => table("Types", "W-01", "W-02", "W-03", "W-10");

describe("rowOf", () => {
  it("writes the cells of a section 8.2 row, with a tick for a law judged in v0.1", () => {
    expect(rowOf(law("W-10"))).toBe(
      "| W-10 | `switch` over a union is exhaustive | R | tl: `switch-exhaustiveness-check` | ✓ |",
    );
  });

  it("leaves the tick empty, with one space, for a law that is not ticked, even when M3 will judge it", () => {
    expect(rowOf(law("W-03"))).toMatch(/\| A \| an \| \|$/);
    expect(rowOf(law("W-36"))).toMatch(/\| R \| an \| \|$/);
  });

  it("escapes a pipe in a cell", () => {
    expect(rowOf(law("W-06"))).toContain("typed `string \\| null` or `string \\| undefined`");
  });
});

describe("syncTables", () => {
  it("leaves a document whose tables already say what the catalog says exactly as it is", () => {
    const text = doc(types());
    const synced = syncTables(text, small);
    expect(synced).toEqual({ ok: true, markdown: text });
  });

  it("rewrites a row that differs, and keeps the heading, the head and the text around the table", () => {
    const stale = types().replace("switch` over a union is exhaustive", "switch` is exhaustive");
    const synced = syncTables(doc(stale), small);
    expect(synced).toEqual({ ok: true, markdown: doc(types()) });
  });

  it("adds a row a law has and the table lacks, and drops a row the catalog does not have", () => {
    const fewer = table("Types", "W-01", "W-02");
    expect(syncTables(doc(fewer), small)).toEqual({ ok: true, markdown: doc(types()) });
    const extra = table("Types", "W-01", "W-02", "W-03", "W-10", "W-11");
    expect(syncTables(doc(extra), small)).toEqual({ ok: true, markdown: doc(types()) });
  });

  it("rewrites each family's table from that family's laws", () => {
    const async = laws.filter((candidate) => ["W-11", "W-14"].includes(candidate.id));
    const stale = table("Async", "W-11", "W-14").replace("Only `Error` objects", "Only errors");
    const synced = syncTables(doc(types(), stale), [...small, ...async]);
    expect(synced).toEqual({ ok: true, markdown: doc(types(), table("Async", "W-11", "W-14")) });
  });

  it("reports a family the text has no table for", () => {
    expect(syncTables(doc(types()), [...small, law("W-11")])).toEqual({
      ok: false,
      problems: ["section 8.2 has no table for the Async and errors family"],
    });
  });

  it("reports a table whose first row names a law with no file", () => {
    const stranger = doc(`**Types**\n\n${head}| W-77 | made up | R | tl | |\n\n`);
    expect(syncTables(stranger, small)).toEqual({
      ok: false,
      problems: [
        "a table row names a law that has no file: | W-77 | made up | R | tl | |",
        "section 8.2 has no table for the Types family",
      ],
    });
  });

  it("reports a family listed twice", () => {
    const twice = doc(table("Types", "W-01", "W-02", "W-03", "W-10"), table("Types again", "W-01"));
    expect(syncTables(twice, small)).toEqual({
      ok: false,
      problems: ["the Types table appears twice"],
    });
  });

  it("does not touch a table row outside section 8.2", () => {
    const elsewhere = `${head}| W-01 | quoted elsewhere | R | tl | |\n\n`;
    const text = `${elsewhere}${doc(types())}${elsewhere}`;
    expect(syncTables(text, small)).toEqual({ ok: true, markdown: text });
  });

  it("refuses a document with no section 8.2, or none followed by 8.3", () => {
    const message = "WEB_TOPS.md has no section 8.2 followed by section 8.3";
    expect(syncTables("# nothing\n", small)).toEqual({ ok: false, problems: [message] });
    expect(syncTables("\n### 8.2 Law catalog\n\n| W-01 | x | R | tl | |\n", small)).toEqual({
      ok: false,
      problems: [message],
    });
    expect(syncTables("\n### 8.3 Law metadata\n\n### 8.2 Law catalog\n", small)).toEqual({
      ok: false,
      problems: [message],
    });
    expect(syncTables("\n### 8.3 Law metadata\n", small)).toEqual({
      ok: false,
      problems: [message],
    });
  });

  it("finds section 8.2 when the text starts with its heading", () => {
    const text = doc(types()).slice("# Title\n\n### 8.1 Model\n\ntext\n".length);
    expect(text.startsWith("\n### 8.2 ")).toBe(true);
    expect(syncTables(text, small)).toEqual({ ok: true, markdown: text });
  });

  it("stops at the first section 8.3 heading: a table after a later 8.3 is not touched", () => {
    const later = `${doc(types())}\n### 8.3 Again\n\n${head}| W-01 | later | R | tl | |\n\n`;
    expect(syncTables(later, small)).toEqual({ ok: true, markdown: later });
  });

  it("reads a row only from the start of a line, so a row quoted inside a sentence is prose", () => {
    const prose = "see | W-01 | in a sentence | R | tl | |\n";
    const text = doc(`${prose}\n${types()}`);
    expect(syncTables(text, small)).toEqual({ ok: true, markdown: text });
  });

  it("names the first line of a table whose first row names no law, a second row not mattering", () => {
    const stranger = doc(`${head}| W-77 | made up | R | tl | |\n| W-01 | second | R | tl | |\n\n`);
    const synced = syncTables(stranger, small);
    expect(synced.ok).toBe(false);
    expect(!synced.ok && synced.problems[0]).toBe(
      "a table row names a law that has no file: | W-77 | made up | R | tl | |",
    );
  });
});
