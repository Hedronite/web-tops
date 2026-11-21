import { describe, expect, it } from "vitest";
import { inputFor, lawOf } from "./testkit.ts";

describe("lawOf", () => {
  it("is a required law of a lint-reader class with the rules it is given", () => {
    const rules = [{ tool: "eslint", name: "no-var" }];
    expect(lawOf("W-01", rules)).toEqual({
      id: "W-01",
      severity: "R",
      reader: "tl",
      classes: [],
      judged: true,
      rules,
    });
  });

  it("takes an override over each default", () => {
    expect(lawOf("W-02", [], { severity: "A", judged: false })).toMatchObject({
      severity: "A",
      judged: false,
    });
  });
});

describe("inputFor", () => {
  it("is a project nowhere, with no artifact and no tracked file, under the real environment", () => {
    const laws = [lawOf("W-01", [])];
    const input = inputFor(laws);
    expect(input.laws).toBe(laws);
    expect(input.tracked).toEqual([]);
    expect(input.held).toBe(false);
    expect(input.ctx.cwd).toBe("/unused");
    expect(input.ctx.base).toBe("origin/main");
    expect(input.ctx.enforce).toBe("hard");
    expect(input.ctx.outDir).toBe("/unused/.web-tops/out");
    expect(input.ctx.env).toBe(process.env);
    expect([...input.ctx.artifacts]).toEqual([]);
  });

  it("takes each option it is given", () => {
    const env = { PATH: "/bin" };
    const input = inputFor([], {
      cwd: "/p",
      artifacts: { "audit-json": "/p/a.json" },
      tracked: ["a.ts"],
      held: true,
      env,
    });
    expect(input.ctx.cwd).toBe("/p");
    expect(input.ctx.outDir).toBe("/p/.web-tops/out");
    expect(input.ctx.artifacts.get("audit-json")).toBe("/p/a.json");
    expect(input.tracked).toEqual(["a.ts"]);
    expect(input.held).toBe(true);
    expect(input.ctx.env).toBe(env);
  });

  it("gives a reader no ESLint to ask", async () => {
    await expect(inputFor([]).eslint()).rejects.toThrow("a non-lint reader asks no ESLint");
  });
});
