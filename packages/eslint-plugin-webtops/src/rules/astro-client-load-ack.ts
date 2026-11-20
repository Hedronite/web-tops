import type { Rule } from "eslint";
import { ackReason } from "../ack.ts";
import { attributeName, child, children, kind } from "../ast.ts";

/** W-28: `client:load` ships and runs JavaScript on every page view, so it needs an acknowledgement. */

const isBlank = (node: unknown): boolean => {
  const text = child(node, "value");
  return kind(node) === "JSXText" && typeof text === "string" && text.trim() === "";
};

/** The node just before the element among its siblings, skipping blank text. */
function nodeBefore(element: unknown): unknown {
  const siblings = children(child(element, "parent"), "children");
  return siblings.slice(0, siblings.indexOf(element)).findLast((node) => !isBlank(node));
}

/** Whether an HTML comment right before the element acknowledges the law: `<!-- webtops-ack W-28: reason -->`. */
function acknowledged(element: unknown): boolean {
  const before = nodeBefore(element);
  const text = child(before, "value");
  return (
    kind(before) === "AstroHTMLComment" &&
    typeof text === "string" &&
    ackReason(text, "W-28") !== undefined
  );
}

const rule: Rule.RuleModule = {
  get meta(): Rule.RuleMetaData {
    return {
      type: "suggestion",
      docs: { description: "`client:load` needs an acknowledgement (W-28)" },
      schema: [],
      messages: {
        unacknowledged:
          "client:load ships and runs JavaScript on every page view. Prefer client:visible, client:idle or no directive, or acknowledge it with a comment right before the element: <!-- webtops-ack W-28: reason -->.",
      },
    };
  },
  create(context) {
    return {
      JSXAttribute(node: Rule.Node) {
        if (attributeName(node) !== "client:load") return;
        const opening: unknown = node.parent;
        if (!acknowledged(child(opening, "parent"))) {
          context.report({ node, messageId: "unacknowledged" });
        }
      },
    };
  },
};

export default rule;
