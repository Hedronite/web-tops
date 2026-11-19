import type { Rule } from "eslint";
import {
  attributeName,
  attributeValue,
  byKind,
  child,
  children,
  dottedName,
  kind,
  nameOf,
  propertyName,
  staticText,
  stringList,
} from "../ast.ts";

/** W-36: HTML reaches `set:html`, `dangerouslySetInnerHTML` or `innerHTML` only as a literal or through a sanitizer. */

const SANITIZERS = ["sanitize", "sanitizeHtml", "DOMPurify.sanitize"];
const ASSIGNED_SINKS = new Set(["innerHTML", "outerHTML"]);
const WRITERS = new Set(["document.write", "document.writeln"]);

/** Where markup goes in, and what is put there. */
interface Sink {
  readonly sink: string;
  readonly html: unknown;
}

type Safe = (node: unknown, sanitizers: ReadonlySet<string>) => boolean;

const SAFE = new Map<string, Safe>([
  ["CallExpression", (node, sanitizers) => sanitizers.has(dottedName(child(node, "callee")) ?? "")],
  [
    "ConditionalExpression",
    (node, sanitizers) =>
      isSafe(child(node, "consequent"), sanitizers) && isSafe(child(node, "alternate"), sanitizers),
  ],
]);

/** A literal, or the result of a sanitizer; a conditional is safe when both branches are. */
export const isSafe = (node: unknown, sanitizers: ReadonlySet<string>): boolean =>
  staticText(node) !== undefined || byKind(SAFE, node)?.(node, sanitizers) === true;

/** What `dangerouslySetInnerHTML={{ __html: x }}` sets: `x`; a value that is not an object literal is its own payload. */
function htmlPayload(value: unknown): unknown {
  if (kind(value) !== "ObjectExpression") return value;
  const entry = children(value, "properties").find(
    (property) => nameOf(child(property, "key")) === "__html",
  );
  return entry === undefined ? { type: "Literal", value: "" } : child(entry, "value");
}

const ATTRIBUTE_SINKS = new Map<string, (value: unknown) => unknown>([
  ["dangerouslySetInnerHTML", htmlPayload],
  ["set:html", (value) => value],
]);

function attributeSink(attribute: unknown): Sink | undefined {
  const name = attributeName(attribute) ?? "";
  const payload = ATTRIBUTE_SINKS.get(name);
  return payload === undefined
    ? undefined
    : { sink: name, html: payload(attributeValue(attribute)) };
}

function assignedSink(assignment: unknown): Sink | undefined {
  const left = child(assignment, "left");
  const sink = kind(left) === "MemberExpression" ? propertyName(left) : undefined;
  return sink !== undefined && ASSIGNED_SINKS.has(sink)
    ? { sink, html: child(assignment, "right") }
    : undefined;
}

function insertedSink(call: unknown): Sink | undefined {
  const callee = child(call, "callee");
  const inserts =
    kind(callee) === "MemberExpression" && propertyName(callee) === "insertAdjacentHTML";
  return inserts ? { sink: "insertAdjacentHTML", html: children(call, "arguments")[1] } : undefined;
}

function writtenSink(call: unknown): Sink | undefined {
  const name = dottedName(child(call, "callee"));
  return name !== undefined && WRITERS.has(name)
    ? { sink: name, html: children(call, "arguments")[0] }
    : undefined;
}

const callSink = (call: unknown): Sink | undefined => insertedSink(call) ?? writtenSink(call);

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "No set:html, dangerouslySetInnerHTML or innerHTML with unsanitized input (W-36)",
    },
    schema: [
      {
        type: "object",
        properties: { sanitizers: { type: "array", items: { type: "string" }, uniqueItems: true } },
        additionalProperties: false,
      },
    ],
    messages: {
      unsanitized:
        "Unsanitized HTML reaches {{ sink }}. Pass a string literal, or the result of a sanitizer ({{ sanitizers }}).",
    },
  },
  create(context) {
    const option: unknown = context.options[0];
    const list = stringList(option, "sanitizers", SANITIZERS);
    const sanitizers = new Set(list);
    const inspect = (node: Rule.Node, found: Sink | undefined): void => {
      if (found === undefined || isSafe(found.html, sanitizers)) return;
      const data = { sink: found.sink, sanitizers: list.join(", ") };
      context.report({ node, messageId: "unsanitized", data });
    };
    return {
      JSXAttribute: (node: Rule.Node) => {
        inspect(node, attributeSink(node));
      },
      AssignmentExpression: (node) => {
        inspect(node, assignedSink(node));
      },
      CallExpression: (node) => {
        inspect(node, callSink(node));
      },
    };
  },
};

export default rule;
