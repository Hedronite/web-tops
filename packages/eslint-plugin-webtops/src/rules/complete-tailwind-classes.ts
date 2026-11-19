import type { Rule } from "eslint";
import {
  attributeName,
  attributeValue,
  byKind,
  child,
  children,
  dottedName,
  kind,
  lookup,
  propertyName,
  quasisOf,
  staticText,
  stringList,
} from "../ast.ts";

/** W-23: a Tailwind class name is a complete string, never built by interpolation or concatenation. */

const CLASS_ATTRIBUTES = new Set(["className", "class"]);
const HELPERS = ["clsx", "cn", "classnames", "classNames", "twMerge", "twJoin", "cva", "tv"];

const endsInToken = (text: string | undefined): boolean => text !== undefined && /\S$/u.test(text);
const startsInToken = (text: string | undefined): boolean =>
  text !== undefined && /^\S/u.test(text);

function templateBuildsToken(template: unknown): boolean {
  const quasis = quasisOf(template);
  const expressions = children(template, "expressions");
  const count = expressions.length;
  // Static text ends in a token character before an interpolation, or starts with one after it,
  // or two interpolations sit side by side (an empty text between them).
  return (
    quasis.slice(0, count).some(endsInToken) ||
    quasis.slice(1, count + 1).some(startsInToken) ||
    quasis.slice(1, count).includes("") ||
    expressions.some(buildsToken)
  );
}

/** Static text meets a computed part with no space between: `"bg-" + color`, `color + "-500"`. */
function pairGlued(left: unknown, right: unknown): boolean {
  const before = staticText(left);
  const after = staticText(right);
  return (
    (after === undefined && endsInToken(before)) || (before === undefined && startsInToken(after))
  );
}

/** The operands of a chain of `+`, left to right. */
function operands(node: unknown): readonly unknown[] {
  const plus = kind(node) === "BinaryExpression" && child(node, "operator") === "+";
  return plus ? [...operands(child(node, "left")), ...operands(child(node, "right"))] : [node];
}

function partsBuildToken(parts: readonly unknown[]): boolean {
  return (
    parts.slice(0, -1).some((part, index) => pairGlued(part, parts[index + 1])) ||
    parts.some(buildsToken)
  );
}

/** Method calls that build a class string: `"bg-".concat(color)` joins like `+`, and `[...].join(" ")` builds from its items. */
const METHODS = new Map<string, (object: unknown, args: readonly unknown[]) => boolean>([
  ["concat", (object, args) => partsBuildToken([object, ...args])],
  ["join", (object) => buildsToken(object)],
]);

function methodBuildsToken(call: unknown): boolean {
  const callee = child(call, "callee");
  const method = lookup(METHODS, propertyName(callee));
  return method?.(child(callee, "object"), children(call, "arguments")) === true;
}

/** A key that is not computed is an identifier or a literal, which cannot build a token. */
const keyBuildsToken = (property: unknown): boolean => buildsToken(child(property, "key"));

const CHECKS = new Map<string, (node: unknown) => boolean>([
  ["TemplateLiteral", templateBuildsToken],
  [
    "BinaryExpression",
    (node) => child(node, "operator") === "+" && partsBuildToken(operands(node)),
  ],
  ["CallExpression", methodBuildsToken],
  [
    "ConditionalExpression",
    (node) => buildsToken(child(node, "consequent")) || buildsToken(child(node, "alternate")),
  ],
  [
    "LogicalExpression",
    (node) => buildsToken(child(node, "left")) || buildsToken(child(node, "right")),
  ],
  ["ArrayExpression", (node) => children(node, "elements").some(buildsToken)],
  ["ObjectExpression", (node) => children(node, "properties").some(keyBuildsToken)],
]);

/** Whether an expression that ends up in a class list builds a class token at run time. */
export const buildsToken = (node: unknown): boolean => byKind(CHECKS, node)?.(node) === true;

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Tailwind class names are complete strings: no class token built by interpolation or concatenation (W-23)",
    },
    schema: [
      {
        type: "object",
        properties: { functions: { type: "array", items: { type: "string" }, uniqueItems: true } },
        additionalProperties: false,
      },
    ],
    messages: {
      incomplete:
        "Tailwind never sees a class name built at run time, so its style is missing in production. Write whole class names and choose between them with a lookup table.",
    },
  },
  create(context) {
    const option: unknown = context.options[0];
    const helpers = new Set(stringList(option, "functions", HELPERS));
    return {
      JSXAttribute(node: Rule.Node) {
        const name = attributeName(node);
        if (name !== undefined && CLASS_ATTRIBUTES.has(name) && buildsToken(attributeValue(node))) {
          context.report({ node, messageId: "incomplete" });
        }
      },
      CallExpression(node) {
        const callee = dottedName(node.callee);
        if (callee !== undefined && helpers.has(callee) && node.arguments.some(buildsToken)) {
          context.report({ node, messageId: "incomplete" });
        }
      },
    };
  },
};

export default rule;
