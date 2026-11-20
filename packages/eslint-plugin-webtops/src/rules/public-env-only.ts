import type { Rule } from "eslint";
import { child, children, dottedName, kind, nameOf, propertyName, stringList } from "../ast.ts";

/** W-37: client code reads only public env: `PUBLIC_` variables, and `astro:env/client` fields. */

const defaultPrefixes = (): string[] => ["PUBLIC_"];
/** What Vite and Astro define for every build, and none of it is a secret. */
const builtIn = (): string[] => ["MODE", "DEV", "PROD", "SSR", "BASE_URL", "SITE"];

/** `process.env` or `import.meta.env`. */
function isEnvObject(node: unknown): boolean {
  const meta = kind(child(node, "object")) === "MetaProperty";
  return dottedName(node) === "process.env" || (meta && propertyName(node) === "env");
}

/** The key of a pattern property: `{ KEY }` and `{ KEY: alias }`; undefined for a computed or rest entry. */
const patternKey = (property: unknown): string | undefined =>
  child(property, "computed") === true ? undefined : nameOf(child(property, "key"));

const isChildOf = (parent: unknown, type: string, field: string, node: unknown): boolean =>
  kind(parent) === type && child(parent, field) === node;

const rule: Rule.RuleModule = {
  get meta(): Rule.RuleMetaData {
    return {
      type: "problem",
      docs: { description: "Only public env reaches client code (W-37)" },
      schema: [
        {
          type: "object",
          properties: {
            prefixes: { type: "array", items: { type: "string" }, uniqueItems: true },
            allowed: { type: "array", items: { type: "string" }, uniqueItems: true },
          },
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
    };
  },
  create(context) {
    const option: unknown = context.options[0];
    const prefixes = stringList(option, "prefixes", defaultPrefixes());
    const allowed = new Set(stringList(option, "allowed", builtIn()));
    const isPublic = (name: string): boolean =>
      allowed.has(name) || prefixes.some((prefix) => name.startsWith(prefix));
    const reportName = (node: Rule.Node, name: string | undefined): void => {
      if (name === undefined) context.report({ node, messageId: "dynamic" });
      else if (!isPublic(name)) {
        context.report({
          node,
          messageId: "private",
          data: { name, prefixes: prefixes.join(", ") },
        });
      }
    };
    const inspectEnv = (node: Rule.Node): void => {
      const parent: unknown = node.parent;
      if (isChildOf(parent, "VariableDeclarator", "init", node)) {
        children(child(parent, "id"), "properties").forEach((property) => {
          reportName(node, patternKey(property));
        });
      } else if (!isChildOf(parent, "MemberExpression", "object", node)) {
        context.report({ node, messageId: "whole" });
      }
    };
    return {
      ImportDeclaration(node) {
        if (node.source.value === "astro:env/server") {
          context.report({ node, messageId: "server", data: { name: "astro:env/server" } });
        }
      },
      MemberExpression(node) {
        if (isEnvObject(node.object)) reportName(node, propertyName(node));
        else if (isEnvObject(node)) inspectEnv(node);
      },
    };
  },
};

export default rule;
