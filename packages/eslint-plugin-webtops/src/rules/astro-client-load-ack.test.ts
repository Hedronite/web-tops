import { RuleTester } from "eslint";
import type { Linter } from "eslint";
import astro from "eslint-plugin-astro";
import { describe, expect, it } from "vitest";
import rule from "./astro-client-load-ack.ts";

RuleTester.describe = describe;
RuleTester.it = it;

/** The language options eslint-plugin-astro gives `.astro` files: the Astro parser, with TypeScript in the frontmatter. */
function astroOptions(): Linter.LanguageOptions {
  const entry = astro.configs["flat/base"].find((config) => config.name === "astro/base");
  if (entry?.languageOptions === undefined) throw new Error("no astro/base config");
  return entry.languageOptions;
}

const tester = new RuleTester({ languageOptions: astroOptions() });

const page = (template: string): { code: string; filename: string } => ({
  code: `---\nimport Widget from "../Widget.tsx";\n---\n${template}\n`,
  filename: "page.astro",
});

const unacknowledged = [{ messageId: "unacknowledged" as const }];

tester.run("astro-client-load-ack", rule, {
  valid: [
    { name: "no directive", ...page("<Widget />") },
    { name: "client:visible", ...page("<Widget client:visible />") },
    { name: "client:idle", ...page("<Widget client:idle />") },
    { name: "client:only", ...page('<Widget client:only="react" />') },
    { name: "another namespaced attribute", ...page("<Widget set:html={x} />") },
    { name: "a plain attribute named load", ...page("<Widget load />") },
    {
      name: "acknowledged by the comment right before",
      ...page("<!-- webtops-ack W-28: the cart must work at once -->\n<Widget client:load />"),
    },
    {
      name: "acknowledged with no space inside the comment",
      ...page("<!--webtops-ack W-28:reason--><Widget client:load />"),
    },
    {
      name: "acknowledged with a reason over several lines",
      ...page(
        "<!--\n  webtops-ack W-28: the cart\n  must work at once\n-->\n<Widget client:load />",
      ),
    },
    {
      name: "acknowledged inside a parent element",
      ...page("<div>\n  <!-- webtops-ack W-28: reason -->\n  <Widget client:load />\n</div>"),
    },
    {
      name: "each of two is acknowledged",
      ...page(
        "<!-- webtops-ack W-28: a -->\n<Widget client:load />\n<!-- webtops-ack W-28: b -->\n<Widget client:load />",
      ),
    },
  ],
  invalid: [
    { name: "bare client:load", ...page("<Widget client:load />"), errors: unacknowledged },
    {
      name: "client:load with other attributes",
      ...page('<Widget a="1" client:load b={2} />'),
      errors: unacknowledged,
    },
    {
      name: "client:load on an element with children",
      ...page("<Widget client:load>text</Widget>"),
      errors: unacknowledged,
    },
    {
      name: "a plain comment",
      ...page("<!-- the cart -->\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "an acknowledgement of another law",
      ...page("<!-- webtops-ack W-30: reason -->\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "an acknowledgement of a law whose number starts with W-28",
      ...page("<!-- webtops-ack W-280: reason -->\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "an acknowledgement with no reason",
      ...page("<!-- webtops-ack W-28: -->\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "the comment after the element",
      ...page("<Widget client:load />\n<!-- webtops-ack W-28: reason -->"),
      errors: unacknowledged,
    },
    {
      name: "an empty comment between the acknowledgement and the element",
      ...page("<!-- webtops-ack W-28: reason -->\n<!-- -->\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "the acknowledgement written as text, not as a comment",
      ...page("webtops-ack W-28: reason\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "the comment before another element",
      ...page("<!-- webtops-ack W-28: reason -->\n<p />\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "the comment before some text",
      ...page("<!-- webtops-ack W-28: reason -->\ntext\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "the comment in a sibling parent",
      ...page("<!-- webtops-ack W-28: reason -->\n<div><Widget client:load /></div>"),
      errors: unacknowledged,
    },
    {
      name: "client:load behind a condition",
      ...page("{show && <Widget client:load />}"),
      errors: unacknowledged,
    },
    {
      name: "one of two is acknowledged",
      ...page("<!-- webtops-ack W-28: a -->\n<Widget client:load />\n<Widget client:load />"),
      errors: unacknowledged,
    },
  ],
});

describe("W-28's rule", () => {
  it("says which law it judges, and reports on the attribute", () => {
    expect(rule.meta).toEqual({
      type: "suggestion",
      docs: { description: "`client:load` needs an acknowledgement (W-28)" },
      schema: [],
      messages: {
        unacknowledged:
          "client:load ships and runs JavaScript on every page view. Prefer client:visible, client:idle or no directive, or acknowledge it with a comment right before the element: <!-- webtops-ack W-28: reason -->.",
      },
    });
  });
});
