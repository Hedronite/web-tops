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
  nameOf,
  propertyName,
  staticText,
  stringList,
} from "../ast.ts";

/** W-36: HTML reaches `set:html`, `dangerouslySetInnerHTML` or `innerHTML` only as a literal or through a sanitizer. */

const defaultSanitizers = (): string[] => ["sanitize", "sanitizeHtml", "DOMPurify.sanitize"];

/** Where markup goes in, and what is put there. */
interface Sink {
  readonly sink: string;
  readonly html: unknown;
}

type Safe = (node: unknown, sanitizers: ReadonlySet<string>) => boolean;

const safeChecks = (): ReadonlyMap<string, Safe> =>
  new Map<string, Safe>([
    [
      "CallExpression",
      (node, sanitizers) => {
        const callee = dottedName(child(node, "callee"));
        return callee !== undefined && sanitizers.has(callee);
      },
    ],
    [
      "ConditionalExpression",
      (node, sanitizers) =>
        isSafe(child(node, "consequent"), sanitizers) &&
        isSafe(child(node, "alternate"), sanitizers),
    ],
  ]);

/** A literal, or the result of a sanitizer; a conditional is safe when both branches are. */
export const isSafe = (node: unknown, sanitizers: ReadonlySet<string>): boolean =>
  staticText(node) !== undefined || byKind(safeChecks(), node)?.(node, sanitizers) === true;

/** What `dangerouslySetInnerHTML={{ __html: x }}` sets: `x`. A value that is not an object literal is its own payload, and an object with no `__html` sets nothing. */
function htmlPayload(value: unknown): { html: unknown } | undefined {
  if (kind(value) !== "ObjectExpression") return { html: value };
  const entry = children(value, "properties").find(
    (property) => nameOf(child(property, "key")) === "__html",
  );
  return entry === undefined ? undefined : { html: child(entry, "value") };
}

const attributeSinks = (): ReadonlyMap<string, (value: unknown) => { html: unknown } | undefined> =>
  new Map([
    ["dangerouslySetInnerHTML", htmlPayload],
    ["set:html", (value) => ({ html: value })],
  ]);

function attributeSink(attribute: unknown): Sink | undefined {
  const name = attributeName(attribute);
  const payload = lookup(attributeSinks(), name)?.(attributeValue(attribute));
  return name === undefined || payload === undefined ? undefined : { sink: name, ...payload };
}

function assignedSink(assignment: unknown): Sink | undefined {
  const sink = propertyName(child(assignment, "left"));
  return sink === "innerHTML" || sink === "outerHTML"
    ? { sink, html: child(assignment, "right") }
    : undefined;
}

function insertedSink(call: unknown): Sink | undefined {
  const callee = child(call, "callee");
  const inserts = propertyName(callee) === "insertAdjacentHTML";
  return inserts ? { sink: "insertAdjacentHTML", html: children(call, "arguments")[1] } : undefined;
}

function writtenSink(call: unknown): Sink | undefined {
  const name = dottedName(child(call, "callee"));
  return name === "document.write" || name === "document.writeln"
    ? { sink: name, html: children(call, "arguments")[0] }
    : undefined;
}

const callSink = (call: unknown): Sink | undefined => insertedSink(call) ?? writtenSink(call);

const rule: Rule.RuleModule = {
  get meta(): Rule.RuleMetaData {
    return {
      type: "problem",
      docs: {
        description:
          "No set:html, dangerouslySetInnerHTML or innerHTML with unsanitized input (W-36)",
      },
      schema: [
        {
          type: "object",
          properties: {
            sanitizers: { type: "array", items: { type: "string" }, uniqueItems: true },
          },
          additionalProperties: false,
        },
      ],
      messages: {
        unsanitized:
          "Unsanitized HTML reaches {{ sink }}. Pass a string literal, or the result of a sanitizer ({{ sanitizers }}).",
      },
    };
  },
  create(context) {
    const option: unknown = context.options[0];
    const list = stringList(option, "sanitizers", defaultSanitizers());
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
