import { RuleTester } from "eslint";
import type { Linter } from "eslint";
import astro from "eslint-plugin-astro";
import { describe, expect, it } from "vitest";
import rule from "./astro-frontmatter-size.ts";

RuleTester.describe = describe;
RuleTester.it = it;

/** The language options eslint-plugin-astro gives `.astro` files: the Astro parser, with TypeScript in the frontmatter. */
function astroOptions(): Linter.LanguageOptions {
  const entry = astro.configs["flat/base"].find((config) => config.name === "astro/base");
  if (entry?.languageOptions === undefined) throw new Error("no astro/base config");
  return entry.languageOptions;
}

const tester = new RuleTester({ languageOptions: astroOptions() });

const page = (frontmatter: string, template = "<p />"): { code: string; filename: string } => ({
  code: `---\n${frontmatter}\n---\n${template}\n`,
  filename: "page.astro",
});

/** `count` statements, one to a line: `const s1 = 1;` and so on. */
const statements = (count: number): string =>
  Array.from(
    { length: count },
    (_, index) => `const s${String(index + 1)} = ${String(index)};`,
  ).join("\n");

const tooLong = (max: number, line: number) => [
  { messageId: "tooLong" as const, data: { max: String(max) }, line },
];

/** One statement of each kind the rule counts. */
const COUNTED: readonly (readonly [string, string])[] = [
  ["an expression", "run();"],
  ["a variable declaration", "const a = 1;"],
  ["a function declaration", "function f() {}"],
  ["a class declaration", "class A {}"],
  ["an if", "if (a) {}"],
  ["a for", "for (;;) {}"],
  ["a for-in", "for (const k in o) {}"],
  ["a for-of", "for (const k of o) {}"],
  ["a while", "while (a) {}"],
  ["a do-while", "do {} while (a);"],
  ["a switch", "switch (a) {}"],
  ["a try", "try {} catch {}"],
  ["a labeled loop", "a: while (b) {}"],
  ["an exported declaration", "export const a = 1;"],
];

tester.run("astro-frontmatter-size", rule, {
  valid: [
    { name: "an empty frontmatter", ...page("") },
    { name: "no frontmatter", code: "<p />\n", filename: "page.astro" },
    { name: "ten statements", ...page(statements(10)) },
    {
      name: "imports are not logic",
      ...page(
        `${Array.from({ length: 12 }, (_, i) => `import a${String(i)} from "./a${String(i)}";`).join("\n")}\n${statements(10)}`,
      ),
    },
    {
      name: "type declarations are not logic",
      ...page(`interface Props { a: string }\ntype A = string;\n${statements(10)}`),
    },
    {
      name: "re-exports are not logic",
      ...page(`export { a } from "./a";\nexport * from "./b";\n${statements(10)}`),
    },
    { name: "empty statements and bare blocks are not logic", ...page(`;\n{}\n${statements(10)}`) },
    {
      name: "statements in the template are not frontmatter",
      ...page("const a = 1;", `{items.map((item) => {\n${statements(12)}\nreturn item;\n})}`),
    },
    { name: "a raised limit", ...page(statements(12)), options: [{ max: 12 }] },
    {
      name: "statements in a script are not frontmatter",
      ...page("const a = 1;", `<script>\n${statements(12)}\n</script>`),
    },
  ],
  invalid: [
    {
      name: "eleven statements, reported at the eleventh",
      ...page(statements(11)),
      errors: tooLong(10, 12),
    },
    {
      name: "many more than eleven report once",
      ...page(statements(25)),
      errors: tooLong(10, 12),
    },
    {
      name: "nested statements count: a function body",
      ...page(`${statements(8)}\nfunction f() {\n  const a = 1;\n  return a;\n}`),
      errors: tooLong(10, 12),
    },
    {
      name: "nested statements count: a branch",
      ...page(`${statements(9)}\nif (s1) {\n  run();\n}`),
      errors: tooLong(10, 12),
    },
    {
      name: "imports beside eleven statements",
      ...page(`import a from "./a";\n${statements(11)}`),
      errors: tooLong(10, 13),
    },
    {
      name: "a lowered limit",
      ...page(statements(3)),
      options: [{ max: 2 }],
      errors: tooLong(2, 4),
    },
    {
      name: "a limit of zero",
      ...page("const zero = 0;"),
      options: [{ max: 0 }],
      errors: tooLong(0, 2),
    },
    ...COUNTED.map(([name, code]) => ({
      name: `${name} counts`,
      ...page(code),
      options: [{ max: 0 }],
      errors: [{ messageId: "tooLong" as const }],
    })),
    {
      name: "return and throw count",
      code: "---\nfunction f() {\n  throw e;\n}\nfunction g() {\n  return 1;\n}\n---\n<p />\n",
      filename: "page.astro",
      options: [{ max: 3 }],
      errors: [{ messageId: "tooLong" as const, line: 6 }],
    },
    {
      name: "break and continue count",
      ...page("while (a) {\n  if (b) {\n    break;\n  }\n  continue;\n}"),
      options: [{ max: 3 }],
      errors: [{ messageId: "tooLong" as const, line: 6 }],
    },
  ],
});

describe("W-31's rule", () => {
  it("says which law it judges, and takes a limit", () => {
    expect(rule.meta).toEqual({
      type: "suggestion",
      docs: { description: "Frontmatter logic beyond 10 statements moves to a .ts module (W-31)" },
      schema: [
        {
          type: "object",
          properties: { max: { type: "integer", minimum: 0 } },
          additionalProperties: false,
        },
      ],
      messages: {
        tooLong:
          "The frontmatter has more than {{ max }} statements. Move the logic into a .ts module and import it, so it can be tested.",
      },
    });
  });
});
