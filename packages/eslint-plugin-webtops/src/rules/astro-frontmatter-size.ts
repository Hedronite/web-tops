import type { Rule } from "eslint";
import { child } from "../ast.ts";

/**
 * W-31: frontmatter logic beyond 10 statements moves to a `.ts` module, where it can be tested.
 * Every statement counts, nested ones too (the body of a function or a branch); imports and type
 * declarations do not, and neither does anything in the template, which starts at `AstroFragment`.
 */

/** The statement types that count. */
const statementTypes = (): string[] => [
  "ExpressionStatement",
  "VariableDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "ReturnStatement",
  "ThrowStatement",
  "TryStatement",
  "BreakStatement",
  "ContinueStatement",
  "LabeledStatement",
];

const rule: Rule.RuleModule = {
  get meta(): Rule.RuleMetaData {
    return {
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
    };
  },
  create(context) {
    const option: unknown = context.options[0];
    const limit = child(option, "max");
    const max = typeof limit === "number" ? limit : 10;
    let inTemplate = false;
    let count = 0;
    return {
      AstroFragment() {
        inTemplate = true;
      },
      [statementTypes().join(", ")](node: Rule.Node) {
        if (inTemplate) return;
        count += 1;
        if (count === max + 1) {
          context.report({ node, messageId: "tooLong", data: { max: String(max) } });
        }
      },
    };
  },
};

export default rule;
