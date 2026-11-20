import type { Rule } from "eslint";
import { attributeName, child, children, kind } from "../ast.ts";

/** W-30: images go through `astro:assets` (`<Image>`, `<Picture>`) with dimensions. */

const isComponent = (name: unknown): boolean => name === "Image" || name === "Picture";

/** The local names `import { Image, Picture } from "astro:assets"` binds, aliases included. */
function assetNames(declaration: unknown): unknown[] {
  return children(declaration, "specifiers")
    .filter((specifier) => isComponent(child(child(specifier, "imported"), "name")))
    .map((specifier) => child(child(specifier, "local"), "name"));
}

/** Whether the tag leaves its dimensions open: neither stated, nor inferred, nor possibly in a spread. */
function lacksDimensions(opening: unknown): boolean {
  const attributes = children(opening, "attributes");
  if (attributes.some((attribute) => kind(attribute) === "JSXSpreadAttribute")) return false;
  const names = new Set(attributes.map(attributeName));
  return !names.has("inferSize") && !(names.has("width") && names.has("height"));
}

const tagName = (opening: unknown): unknown => child(child(opening, "name"), "name");

const rule: Rule.RuleModule = {
  get meta(): Rule.RuleMetaData {
    return {
      type: "suggestion",
      docs: { description: "Images go through astro:assets with dimensions (W-30)" },
      schema: [],
      messages: {
        raw: "An <img> is not optimized. Use <Image> or <Picture> from astro:assets, with width and height.",
        dimensions:
          "<{{ name }}> needs width and height (or inferSize), so the layout does not shift.",
      },
    };
  },
  create(context) {
    const bound = new Set<unknown>();
    return {
      ImportDeclaration(node: Rule.Node) {
        if (child(child(node, "source"), "value") === "astro:assets")
          assetNames(node).forEach((name) => bound.add(name));
      },
      JSXOpeningElement(node: Rule.Node) {
        const name = tagName(node);
        if (name === "img") context.report({ node, messageId: "raw" });
        else if (bound.has(name) && lacksDimensions(node)) {
          context.report({ node, messageId: "dimensions", data: { name: String(name) } });
        }
      },
    };
  },
};

export default rule;
