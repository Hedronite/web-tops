import { describe, expect, it } from "vitest";
import { analyze, goldens, lineOf, shape } from "./test-support.ts";

const CASES = goldens();

describe("golden fixtures: every construct of WEB_TOPS.md 6.3 and the identity rules of 6.7", () => {
  it("has a fixture for each group of the plan", () => {
    const names = CASES.map((golden) => golden.name);
    for (const group of [
      "counted",
      "nullish",
      "not-counted",
      "nesting",
      "classes",
      "units",
      "tsx",
      "jsx",
    ]) {
      expect(names).toContain(group);
    }
    for (const group of [
      "astro-frontmatter",
      "astro-template",
      "astro-script",
      "astro-crlf",
      "identity",
    ]) {
      expect(names).toContain(group);
    }
  });

  describe.each(CASES)("$name", (golden) => {
    const path = `input.${golden.file.split(".").at(-1) ?? ""}`;

    it("counts and names every function as the hand-written expected.json says", () => {
      const found = analyze(path, golden.text);
      expect(found.records.map(shape)).toEqual(golden.records);
      expect(found.diagnostics.length > 0).toBe(golden.diagnostics === "some");
    });

    it("counts the nullish operators as 1 each when the discount is off", () => {
      if (golden.withoutDiscount === undefined) return;
      const found = analyze(path, golden.text, false);
      expect(found.records.map(shape)).toEqual(golden.withoutDiscount);
    });

    it("keeps its records consistent: key parts, ordinals, offsets, one module first", () => {
      const { records } = analyze(path, golden.text);
      expect(records[0]?.kind).toBe("module");
      expect(new Set(records.map((found) => found.key)).size).toBe(records.length);
      for (const found of records) {
        const tail = found.key.slice(`${path}::`.length);
        if (found.kind === "module") expect(tail).toBe("<module>");
        else expect([...found.container, found.name].join(".")).toBe(tail);
        expect(found.ordinal === undefined).toBe(!/~\d+$/.test(found.name));
        expect(lineOf(golden.text, found.span.start)).toBe(found.span.startLine);
        expect(found.span.end).toBeGreaterThan(found.span.start);
        expect(found.score).toBeGreaterThanOrEqual(found.own);
      }
    });
  });
});
