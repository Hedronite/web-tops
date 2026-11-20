import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import rule from "./public-env-only.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

const privateName = (name: string) => [
  { messageId: "private" as const, data: { name, prefixes: "PUBLIC_" } },
];

tester.run("public-env-only", rule, {
  valid: [
    { name: "import.meta.url handed on", code: "send(import.meta.url);" },
    { name: "another member handed on", code: "send(other.value);" },
    { name: "a member of a call result", code: "send(a.env);" },
    {
      name: "two prefixes, the second one matching",
      code: "const a = process.env.B_KEY;",
      options: [{ prefixes: ["A_", "B_"] }],
    },
    {
      name: "a public import.meta.env variable",
      code: "const a = import.meta.env.PUBLIC_API_URL;",
    },
    { name: "a public process.env variable", code: "const a = process.env.PUBLIC_API_URL;" },
    { name: "a built-in", code: "const a = import.meta.env.MODE + import.meta.env.BASE_URL;" },
    {
      name: "every built-in",
      code: "const a = [import.meta.env.DEV, import.meta.env.PROD, import.meta.env.SSR, import.meta.env.SITE];",
    },
    { name: "a computed public name", code: 'const a = import.meta.env["PUBLIC_KEY"];' },
    {
      name: "a destructured public variable",
      code: "const { PUBLIC_KEY, MODE } = import.meta.env;",
    },
    {
      name: "a renamed destructured public variable",
      code: "const { PUBLIC_KEY: key } = process.env;",
    },
    { name: "the client module", code: 'import { PUBLIC_X } from "astro:env/client";' },
    { name: "another import", code: 'import { x } from "./x";' },
    { name: "another object named env", code: "const a = config.env.SECRET;" },
    { name: "another meta property", code: "const a = import.meta.url;" },
    { name: "another process property", code: "const a = process.argv;" },
    {
      name: "a custom prefix",
      code: "const a = process.env.NEXT_PUBLIC_KEY;",
      options: [{ prefixes: ["NEXT_PUBLIC_"] }],
    },
    {
      name: "a custom allowed name",
      code: "const a = process.env.NODE_ENV;",
      options: [{ allowed: ["NODE_ENV"] }],
    },
    { name: "a member of another object", code: "const a = other.SECRET;" },
    {
      name: "a nested access on a public value",
      code: "const a = process.env.PUBLIC_LIST.length;",
    },
  ],
  invalid: [
    {
      name: "the env object as the init of a for loop",
      code: "for (process.env; ; ) {}",
      errors: [{ messageId: "whole" }],
    },
    {
      name: "the env object as a computed key",
      code: "const a = x[process.env];",
      errors: [{ messageId: "whole" }],
    },
    {
      name: "two prefixes are listed in the message",
      code: "const a = process.env.KEY;",
      options: [{ prefixes: ["A_", "B_"] }],
      errors: [{ messageId: "private", data: { name: "KEY", prefixes: "A_, B_" } }],
    },
    {
      name: "a private import.meta.env variable",
      code: "const a = import.meta.env.SECRET_KEY;",
      errors: privateName("SECRET_KEY"),
    },
    {
      name: "a private process.env variable",
      code: "const a = process.env.DATABASE_URL;",
      errors: privateName("DATABASE_URL"),
    },
    {
      name: "a private variable by string key",
      code: 'const a = process.env["DATABASE_URL"];',
      errors: privateName("DATABASE_URL"),
    },
    {
      name: "a computed name",
      code: "const a = import.meta.env[name];",
      errors: [{ messageId: "dynamic" }],
    },
    {
      name: "a destructured private variable",
      code: "const { SECRET } = import.meta.env;",
      errors: privateName("SECRET"),
    },
    {
      name: "a renamed destructured private variable",
      code: "const { SECRET: s } = process.env;",
      errors: privateName("SECRET"),
    },
    {
      name: "a rest element",
      code: "const { ...all } = process.env;",
      errors: [{ messageId: "dynamic" }],
    },
    {
      name: "a computed pattern key",
      code: "const { [name]: v } = process.env;",
      errors: [{ messageId: "dynamic" }],
    },
    {
      name: "the whole object passed on",
      code: "send(import.meta.env);",
      errors: [{ messageId: "whole" }],
    },
    {
      name: "the whole process.env spread",
      code: "const a = { ...process.env };",
      errors: [{ messageId: "whole" }],
    },
    {
      name: "the server module",
      code: 'import { SECRET } from "astro:env/server";',
      errors: [{ messageId: "server", data: { name: "astro:env/server" } }],
    },
    {
      name: "a prefix the options replaced",
      code: "const a = process.env.PUBLIC_KEY;",
      options: [{ prefixes: ["NEXT_PUBLIC_"] }],
      errors: [{ messageId: "private", data: { name: "PUBLIC_KEY", prefixes: "NEXT_PUBLIC_" } }],
    },
    {
      name: "a built-in the options removed",
      code: "const a = import.meta.env.MODE;",
      options: [{ allowed: [] }],
      errors: privateName("MODE"),
    },
    {
      name: "two private variables",
      code: "const a = [process.env.A, process.env.B];",
      errors: [{ messageId: "private" }, { messageId: "private" }],
    },
  ],
});

describe("the rule's own description", () => {
  it("states what it judges, its options and its messages", () => {
    const list = { type: "array", items: { type: "string" }, uniqueItems: true };
    expect(rule.meta).toEqual({
      type: "problem",
      docs: { description: "Only public env reaches client code (W-37)" },
      schema: [
        {
          type: "object",
          properties: { prefixes: list, allowed: list },
          additionalProperties: false,
        },
      ],
      messages: {
        private:
          "{{ name }} is not a public variable (prefix {{ prefixes }}), so reading it in client code ships it to every visitor. Read it on the server.",
        dynamic:
          "An env variable read by a computed name cannot be checked, and may be private. Read a public variable by name.",
        whole:
          "The whole env object reaches client code. Read the public variables you need, by name.",
        server:
          "{{ name }} is a server-only module: its fields stay off the client. Use astro:env/client.",
      },
    });
  });
});
