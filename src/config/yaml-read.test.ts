import { describe, expect, it } from "vitest";
import { parseYaml } from "./validate.ts";

describe("G3 a YAML document that parses but cannot be turned into a value", () => {
  it("is a problem at the top of the document, with the reason", () => {
    const aliases = Array.from({ length: 300 }, () => "*x").join(", ");
    const text = `a: &x [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]\nb: [${aliases}]\n`;
    const result = parseYaml(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]?.pointer).toBe("");
      expect(result.problems[0]?.message).toMatch(/alias/i);
    }
  });
});
