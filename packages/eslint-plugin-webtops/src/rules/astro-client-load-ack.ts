import type { Rule } from "eslint";
import { relative, sep } from "node:path";
import { ackReason } from "../ack.ts";
import { attributeName, child, children, kind, linesBetween, stringList } from "../ast.ts";

/**
 * W-28: `client:load` ships and runs JavaScript on every page view, so it needs an acknowledgement: an HTML
 * comment on the line above the element (or on its line), or an entry for the file in the ack ledger, which
 * the preset passes in as `ackedFiles`. The finding is the opening tag's first line.
 */

const isBlank = (node: unknown): boolean => {
  const text = child(node, "value");
  return kind(node) === "JSXText" && typeof text === "string" && text.trim() === "";
};

/** The node just before the element among its siblings, skipping blank text. */
function nodeBefore(element: unknown): unknown {
  const siblings = children(child(element, "parent"), "children");
  return siblings.slice(0, siblings.indexOf(element)).findLast((node) => !isBlank(node));
}

/** Whether the node is an HTML comment that acknowledges the law: `<!-- webtops-ack W-28: reason -->`. */
function isAck(node: unknown): boolean {
  const text = child(node, "value");
  return (
    kind(node) === "AstroHTMLComment" &&
    typeof text === "string" &&
    ackReason(text, "W-28") !== undefined
  );
}

/** Whether a comment right before the element, starting on its line or the line above, acknowledges the law. */
function acknowledged(element: unknown, opening: unknown): boolean {
  const before = nodeBefore(element);
  const gap = linesBetween(before, opening);
  return isAck(before) && (gap === 0 || gap === 1);
}

const rule: Rule.RuleModule = {
  get meta(): Rule.RuleMetaData {
    return {
      type: "suggestion",
      docs: { description: "`client:load` needs an acknowledgement (W-28)" },
      schema: [
        {
          type: "object",
          properties: { ackedFiles: { type: "array", items: { type: "string" } } },
          additionalProperties: false,
        },
      ],
      messages: {
        unacknowledged:
          "client:load ships and runs JavaScript on every page view. Prefer client:visible, client:idle or no directive, or acknowledge it with a comment on the line above the element: <!-- webtops-ack W-28: reason -->, or an entry in the ack ledger.",
      },
    };
  },
  create(context) {
    const acked = stringList(context.options[0], "ackedFiles", []);
    if (acked.includes(relative(context.cwd, context.filename).split(sep).join("/"))) return {};
    return {
      JSXOpeningElement(node: Rule.Node) {
        const loads = children(node, "attributes").some(
          (attribute) => attributeName(attribute) === "client:load",
        );
        if (loads && !acknowledged(child(node, "parent"), node)) {
          context.report({ node, messageId: "unacknowledged" });
        }
      },
    };
  },
};

export default rule;
