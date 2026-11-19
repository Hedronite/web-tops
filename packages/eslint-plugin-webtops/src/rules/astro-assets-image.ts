import type { Rule } from "eslint";
import { attributeName, child, children, kind, nameOf } from "../ast.ts";

/** W-30: images go through `astro:assets` (`<Image>`, `<Picture>`) with dimensions. */

const COMPONENTS = ["Image", "Picture"];

/** The attributes that give an image its dimensions: both sides, or a size Astro reads from the file. */
const SIZED = ["width", "height"];
const INFERRED = "inferSize";

/** The local names `import { Image, Picture } from "astro:assets"` binds, aliases included. */
function assetNames(declaration: unknown): string[] {
  return children(declaration, "specifiers")
    .filter((specifier) => COMPONENTS.includes(nameOf(child(specifier, "imported")) ?? ""))
    .map((specifier) => nameOf(child(specifier, "local")) ?? "");
}

/** Whether the tag leaves its dimensions open: neither stated, nor inferred, nor possibly in a spread. */
function lacksDimensions(opening: unknown): boolean {
  const attributes = children(opening, "attributes");
  if (attributes.some((attribute) => kind(attribute) === "JSXSpreadAttribute")) return false;
  const names = new Set(attributes.map(attributeName));
  return !names.has(INFERRED) && !SIZED.every((name) => names.has(name));
}

const tagName = (opening: unknown): string => nameOf(child(opening, "name")) ?? "";

const rule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: { description: "Images go through astro:assets with dimensions (W-30)" },
    schema: [],
    messages: {
      raw: "An <img> is not optimized. Use <Image> or <Picture> from astro:assets, with width and height.",
      dimensions:
        "<{{ name }}> needs width and height (or inferSize), so the layout does not shift.",
    },
  },
  create(context) {
    const bound = new Set<string>();
    return {
      ImportDeclaration(node: Rule.Node) {
        if (child(child(node, "source"), "value") === "astro:assets")
          assetNames(node).forEach((name) => bound.add(name));
      },
      JSXOpeningElement(node: Rule.Node) {
        const name = tagName(node);
        if (name === "img") context.report({ node, messageId: "raw" });
        else if (bound.has(name) && lacksDimensions(node)) {
          context.report({ node, messageId: "dimensions", data: { name } });
        }
      },
    };
  },
};

export default rule;
