import { Linter, RuleTester } from "eslint";
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
      name: "acknowledged by a comment on the element's own line",
      ...page("<!-- webtops-ack W-28: reason --><Widget client:load />"),
    },
    {
      name: "acknowledged above a tag that spans lines",
      ...page("<!-- webtops-ack W-28: reason -->\n<Widget\n  a={1}\n  client:load\n/>"),
    },
    {
      name: "acknowledged by the ledger, for the file the entry names",
      ...page("<Widget client:load />"),
      options: [{ ackedFiles: ["page.astro"] }],
    },
    {
      name: "acknowledged by the ledger among other files",
      ...page("<Widget client:load />"),
      options: [{ ackedFiles: ["src/other.astro", "page.astro"] }],
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
      name: "a comment that starts two lines above",
      ...page("<!-- webtops-ack W-28: reason -->\n\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "a comment over several lines, whose first line is more than one line above",
      ...page("<!--\n  webtops-ack W-28: reason\n-->\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "a reason on the second line of the comment",
      ...page("<!-- webtops-ack W-28:\nreason -->\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "a reason of punctuation only, which the kit rejects too",
      ...page("<!-- webtops-ack W-28: . -->\n<Widget client:load />"),
      errors: unacknowledged,
    },
    {
      name: "the ledger names another file",
      ...page("<Widget client:load />"),
      options: [{ ackedFiles: ["src/other.astro"] }],
      errors: unacknowledged,
    },
    {
      name: "no ledger option, in a file that happens to be named like one of its mutants",
      code: page("<Widget client:load />").code,
      filename: "Stryker was here",
      errors: unacknowledged,
    },
    {
      name: "the ledger names no file",
      ...page("<Widget client:load />"),
      options: [{ ackedFiles: [] }],
      errors: unacknowledged,
    },
    {
      name: "the ledger names a file whose path ends with this one",
      ...page("<Widget client:load />"),
      options: [{ ackedFiles: ["src/page.astro"] }],
      errors: unacknowledged,
    },
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
  it("says which law it judges, takes the ledger's files as an option, and says how to acknowledge", () => {
    expect(rule.meta).toEqual({
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
    });
  });
});

/** Where the rule reports a page's findings, as `line:column`. */
function reportedAt(template: string): string[] {
  const linter = new Linter();
  const messages = linter.verify(
    page(template).code,
    [
      {
        files: ["**/*.astro"],
        languageOptions: astroOptions(),
        plugins: { webtops: { rules: { r: rule } } },
        rules: { "webtops/r": "error" },
      },
    ],
    "page.astro",
  );
  return messages.map((found) => `${String(found.line)}:${String(found.column)}`);
}

describe("W-28's report", () => {
  it("is the opening tag's first line, whatever line the directive is on", () => {
    expect(reportedAt("<Widget client:load />")).toEqual(["4:1"]);
    expect(reportedAt("<Widget\n  a={1}\n  client:load\n/>")).toEqual(["4:1"]);
    expect(reportedAt("<div>\n  <Widget\n    client:load\n  />\n</div>")).toEqual(["5:3"]);
  });
});
