import { describe, expect, it } from "vitest";
import type { Law } from "./types.ts";
import { findLaw } from "./query.ts";
import { join, resolve } from "node:path";
import { loadCatalog } from "./load.ts";
import { explainText, listText } from "./view.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

/** The kit's own catalog, loaded: a test that needs the real laws fails here if the catalog is invalid. */
function realLaws(): readonly Law[] {
  const loaded = loadCatalog(join(ROOT, "laws"));
  if (!loaded.ok) throw new Error(loaded.problems.map((found) => found.message).join("; "));
  return loaded.laws;
}

const laws = realLaws();
const law = (id: string) => {
  const found = findLaw(laws, id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};

describe("listText", () => {
  it("counts the laws shown against the catalog, with the filter in words, then one row per law", () => {
    const text = listText([law("W-01"), law("W-04")], 48, { cls: "ts-library", required: true });
    expect(text.split("\n")).toEqual([
      "2 of 48 laws (class ts-library, required)",
      `W-01  R  tl     v0.1  ${law("W-01").title}`,
      `W-04  R  an     v0.1  ${law("W-04").title}`,
      "",
    ]);
  });

  it("names each filter alone, and none when there is none", () => {
    expect(listText([], 48, { cls: "web-app", required: false })).toBe(
      "0 of 48 laws (class web-app)\n",
    );
    expect(listText([], 48, { cls: undefined, required: true })).toBe("0 of 48 laws (required)\n");
    expect(listText([], 48, { cls: undefined, required: false })).toBe("0 of 48 laws\n");
  });

  it("shows every reader kind, the judged column padded, and a conditional law with its condition", () => {
    const text = listText([law("W-06"), law("W-36"), law("W-27")], 48, {
      cls: "web-app",
      required: false,
    });
    expect(text).toContain("W-06  R  tl+an  v0.1  ");
    expect(text).toContain("W-36  R  an     m3    ");
    expect(text).toContain("(only when the project depends on Astro)\n");
  });

  it("does not add the condition for a class that maps the law without one", () => {
    const text = listText([law("W-27")], 48, { cls: "astro-site", required: false });
    expect(text).not.toContain("Astro)");
  });
});

describe("explainText", () => {
  it("says which classes a rule applies to when it does not apply to all of the law's", () => {
    const text = explainText(law("W-22"));
    expect(text).toContain("\n  eslint  astro/jsx-a11y/alt-text  (astro-site only)\n");
    expect(text).toContain("\n  eslint  jsx-a11y-x/alt-text\n");
  });

  it("lists each class of a rule that names several, comma separated", () => {
    const base = law("W-22");
    const text = explainText({
      ...base,
      rules: [{ tool: "eslint", name: "some-rule", classes: ["astro-site", "web-app"] }],
    });
    expect(text).toContain("\n  eslint  some-rule  (astro-site, web-app only)\n");
  });

  it("prints every field of a law, one line each", () => {
    const text = explainText(law("W-01"));
    const lines = text.split("\n");
    expect(lines[0]).toBe(`W-01  ${law("W-01").title}`);
    expect(lines.slice(1, 5)).toEqual([
      "family:    Types",
      "severity:  R (a break is refuse)",
      "classes:   ts-library, ui-components, astro-site, web-app, node-service",
      "kinds:     tl",
    ]);
    expect(text).toContain("\nreader:    tl: `no-explicit-any`");
    expect(text).toContain("\nrules:\n  eslint  @typescript-eslint/no-explicit-any\n");
    expect(text).toContain("\njudged:    v0.1 (ticked in section 8.2)\n");
    expect(text).toContain("\nrationale: An `any` switches");
    expect(text).toContain("\nfix:       Type the value");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("says what each severity and each judged value mean", () => {
    expect(explainText(law("W-03"))).toContain(
      "severity:  A (a break needs an acknowledgement, or is ack-missing)",
    );
    expect(explainText(law("W-03"))).toContain("judged:    no (not judged yet)");
    expect(explainText(law("W-36"))).toContain("judged:    m3 (gets a reader in M3)");
  });

  it("says none for a law with no tool rules, and prints a note only when there is one", () => {
    expect(explainText(law("W-03"))).toContain("\nrules: none\n");
    expect(explainText(law("W-03"))).not.toContain("note:");
    expect(explainText(law("W-06"))).toContain("\nnote:      node-service reads this law strictly");
  });

  it("marks the classes that map a law only with Astro", () => {
    expect(explainText(law("W-27"))).toContain(
      "classes:   ui-components (only when the project depends on Astro), astro-site, web-app (only when the project depends on Astro)",
    );
  });

  it("joins several reader kinds with a plus", () => {
    expect(explainText(law("W-06"))).toContain("\nkinds:     tl+an\n");
  });

  it("prints a law with no rules and no note as exactly ten lines, and no line more", () => {
    const lines = explainText(law("W-03")).split("\n");
    expect(lines).toHaveLength(11);
    expect(lines[10]).toBe("");
    expect(lines[6]).toBe("rules: none");
  });
});
