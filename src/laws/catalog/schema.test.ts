import { describe, expect, it } from "vitest";
import { validateLaw } from "./schema.ts";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "../../..");

/** One law file of the kit, read as the plain object the YAML holds (a test mutates a copy of it). */
function plainLaw(id: string): Record<string, unknown> {
  const doc: unknown = parse(readFileSync(join(ROOT, "laws", `${id}.yaml`), "utf8"));
  if (typeof doc !== "object" || doc === null) throw new Error(`${id}.yaml is not a map`);
  return Object.fromEntries(Object.entries(doc));
}

/** A valid law with the given fields replaced (a field set to `undefined` is removed). */
function lawWith(changes: Record<string, unknown>): unknown {
  const law = plainLaw("W-27");
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) Reflect.deleteProperty(law, name);
    else Reflect.set(law, name, value);
  }
  return law;
}

const problemsOf = (value: unknown): string[] => {
  const checked = validateLaw(value);
  return checked.ok ? [] : checked.problems.map((found) => `${found.pointer} ${found.message}`);
};

describe("validateLaw (G1a: an invalid file fails)", () => {
  it("accepts a law as the catalog writes it, with and without the optional fields", () => {
    expect(validateLaw(lawWith({}))).toMatchObject({ ok: true });
    expect(validateLaw(lawWith({ note: undefined, conditional_classes: undefined }))).toMatchObject(
      { ok: true },
    );
  });

  it.each([
    "id",
    "title",
    "family",
    "severity",
    "classes",
    "reader",
    "rules",
    "judged",
    "rationale",
    "fix",
  ])("fails a law with no %s, naming it", (field) => {
    expect(problemsOf(lawWith({ [field]: undefined }))).toEqual([
      `/${field} must have required property '${field}'`,
    ]);
  });

  it("fails a reader with no kinds or no text, and one with an unknown kind", () => {
    expect(problemsOf(lawWith({ reader: { text: "tl: x" } }))).toEqual([
      "/reader/kinds must have required property 'kinds'",
    ]);
    expect(problemsOf(lawWith({ reader: { kinds: ["tl"] } }))).toEqual([
      "/reader/text must have required property 'text'",
    ]);
    expect(problemsOf(lawWith({ reader: { kinds: ["ai"], text: "x" } }))).toHaveLength(1);
    expect(problemsOf(lawWith({ reader: { kinds: [], text: "x" } }))).toHaveLength(1);
    expect(problemsOf(lawWith({ reader: { kinds: ["tl", "tl"], text: "x" } }))).toHaveLength(1);
  });

  it("fails a class that is not a launch class, an empty list and a repeated class", () => {
    expect(problemsOf(lawWith({ classes: ["cli"], conditional_classes: undefined }))).toHaveLength(
      1,
    );
    expect(problemsOf(lawWith({ classes: [], conditional_classes: undefined }))).toHaveLength(1);
    expect(
      problemsOf(lawWith({ classes: ["web-app", "web-app"], conditional_classes: undefined })),
    ).toHaveLength(1);
    expect(problemsOf(lawWith({ classes: "web-app" }))).toHaveLength(1);
  });

  it("fails a conditional class that is not one of the law's classes, and says so", () => {
    expect(
      problemsOf(lawWith({ classes: ["web-app"], conditional_classes: ["astro-site"] })),
    ).toEqual(["/conditional_classes astro-site is not in classes"]);
    expect(
      problemsOf(lawWith({ classes: ["web-app", "astro-site"], conditional_classes: ["web-app"] })),
    ).toEqual([]);
    expect(problemsOf(lawWith({ conditional_classes: [] }))).toHaveLength(1);
  });

  it("accepts a rule's classes among the law's, and fails one that is not, an empty list and a repeat", () => {
    const withRule = (classes: unknown): unknown =>
      lawWith({
        classes: ["web-app", "astro-site"],
        conditional_classes: undefined,
        rules: [
          { tool: "eslint", name: "a/b" },
          { tool: "eslint", name: "c/d", classes },
        ],
      });
    expect(problemsOf(withRule(["astro-site"]))).toEqual([]);
    expect(problemsOf(withRule(["ui-components"]))).toEqual([
      "/rules/1/classes ui-components is not in classes",
    ]);
    expect(problemsOf(withRule([]))).toHaveLength(1);
    expect(problemsOf(withRule(["astro-site", "astro-site"]))).toHaveLength(1);
    expect(problemsOf(withRule(["cli"]))).toHaveLength(1);
    expect(problemsOf(withRule("astro-site"))).toHaveLength(1);
  });

  it("fails a severity, a judged value and an id the schema does not allow", () => {
    expect(problemsOf(lawWith({ severity: "X" }))).toHaveLength(1);
    expect(problemsOf(lawWith({ judged: "yes" }))).toHaveLength(1);
    expect(problemsOf(lawWith({ id: "law-1" }))).toHaveLength(1);
    expect(problemsOf(lawWith({ id: "W-1" }))).toHaveLength(1);
    expect(problemsOf(lawWith({ id: "W-100" }))).toEqual([]);
  });

  it("fails empty text where text is required, and a rule that has no tool or no name", () => {
    for (const field of ["title", "family", "rationale", "fix", "note"]) {
      expect(problemsOf(lawWith({ [field]: "" })), field).toHaveLength(1);
    }
    expect(problemsOf(lawWith({ rules: [{ tool: "eslint" }] }))).toHaveLength(1);
    expect(problemsOf(lawWith({ rules: [{ name: "x" }] }))).toHaveLength(1);
    expect(problemsOf(lawWith({ rules: [{ tool: "", name: "x" }] }))).toHaveLength(1);
    expect(problemsOf(lawWith({ rules: [{ tool: "a", name: "" }] }))).toHaveLength(1);
    expect(problemsOf(lawWith({ rules: [{ tool: "a", name: "b", extra: 1 }] }))).toHaveLength(1);
  });

  it("fails a field the schema does not know", () => {
    expect(problemsOf(lawWith({ owner: "web-platform" }))).toEqual([
      "/owner must NOT have additional properties",
    ]);
  });

  it("fails a value that is not a map", () => {
    expect(problemsOf("W-01")).toHaveLength(1);
    expect(problemsOf(null)).toHaveLength(1);
    expect(problemsOf([])).toHaveLength(1);
  });
});
