import { RuleTester } from "eslint";
import type { Linter } from "eslint";
import astro from "eslint-plugin-astro";
import { describe, expect, it } from "vitest";
import rule from "./astro-assets-image.ts";

RuleTester.describe = describe;
RuleTester.it = it;

/** The language options eslint-plugin-astro gives `.astro` files: the Astro parser, with TypeScript in the frontmatter. */
function astroOptions(): Linter.LanguageOptions {
  const entry = astro.configs["flat/base"].find((config) => config.name === "astro/base");
  if (entry?.languageOptions === undefined) throw new Error("no astro/base config");
  return entry.languageOptions;
}

const tester = new RuleTester({ languageOptions: astroOptions() });

const IMPORT = 'import { Image, Picture } from "astro:assets";';

const page = (template: string, imports = IMPORT): { code: string; filename: string } => ({
  code: `---\n${imports}\nimport hero from "../hero.png";\n---\n${template}\n`,
  filename: "page.astro",
});

const raw = [{ messageId: "raw" as const }];
const lacking = (name: string) => [{ messageId: "dimensions" as const, data: { name } }];

tester.run("astro-assets-image", rule, {
  valid: [
    {
      name: "an Image with dimensions",
      ...page('<Image src={hero} width={800} height={600} alt="" />'),
    },
    {
      name: "a Picture with dimensions",
      ...page('<Picture src={hero} width="800" height="600" alt="" />'),
    },
    {
      name: "an Image whose size Astro reads from the file",
      ...page('<Image src="https://a.test/a.png" inferSize alt="" />'),
    },
    {
      name: "an Image with a spread that may carry the dimensions",
      ...page("<Image {...props} />"),
    },
    {
      name: "a spread beside other attributes",
      ...page('<Image src={hero} {...props} alt="" />'),
    },
    {
      name: "a named Image from another module",
      ...page('<Image src="a" />', 'import { Image } from "../components";'),
    },
    {
      name: "a member element is not read as an Image",
      ...page('<assets.Image src="a" />', 'import * as assets from "astro:assets";'),
    },
    {
      name: "an aliased import",
      ...page(
        '<Img src={hero} width={1} height={2} alt="" />',
        'import { Image as Img } from "astro:assets";',
      ),
    },
    {
      name: "an Image from another module is not the astro:assets one",
      ...page('<Image src="a" />', 'import Image from "../Image.astro";'),
    },
    {
      name: "an Image that is not imported",
      ...page('<Image src="a" />', ""),
    },
    {
      name: "another member of astro:assets",
      ...page('<Foo src="a" />', 'import { getImage as Foo } from "astro:assets";'),
    },
    { name: "an ordinary element", ...page("<div><picture /><p>text</p></div>") },
    {
      name: "a default import named Image",
      ...page('<Image src="a" />', 'import Image from "astro:assets";'),
    },
  ],
  invalid: [
    { name: "an img", ...page('<img src="a.png" alt="" />'), errors: raw },
    {
      name: "an img with width and height",
      ...page('<img src="a.png" width="1" height="2" />'),
      errors: raw,
    },
    { name: "an img with an expression source", ...page("<img src={hero.src} />"), errors: raw },
    {
      name: "two img elements, in a parent",
      ...page('<div><img src="a" /><img src="b" /></div>'),
      errors: [...raw, ...raw],
    },
    {
      name: "an Image with no dimensions",
      ...page('<Image src={hero} alt="" />'),
      errors: lacking("Image"),
    },
    {
      name: "an Image with a width only",
      ...page('<Image src={hero} width={1} alt="" />'),
      errors: lacking("Image"),
    },
    {
      name: "an Image with a height only",
      ...page('<Image src={hero} height={1} alt="" />'),
      errors: lacking("Image"),
    },
    {
      name: "a Picture with no dimensions",
      ...page('<Picture src={hero} alt="" />'),
      errors: lacking("Picture"),
    },
    {
      name: "an aliased Image with no dimensions, named by its tag",
      ...page('<Img src={hero} alt="" />', 'import { Image as Img } from "astro:assets";'),
      errors: lacking("Img"),
    },
    {
      name: "an Image imported with a second one",
      ...page("<Picture src={hero} />", 'import { Picture, Image } from "astro:assets";'),
      errors: lacking("Picture"),
    },
  ],
});

describe("W-30's rule", () => {
  it("says which law it judges", () => {
    expect(rule.meta).toEqual({
      type: "suggestion",
      docs: { description: "Images go through astro:assets with dimensions (W-30)" },
      schema: [],
      messages: {
        raw: "An <img> is not optimized. Use <Image> or <Picture> from astro:assets, with width and height.",
        dimensions:
          "<{{ name }}> needs width and height (or inferSize), so the layout does not shift.",
      },
    });
  });
});
