import type { Linter } from "eslint";
import { afterAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { eslintPreset } from "./eslint.js";
import type { EslintVariant } from "./eslint.js";
import {
  TSCONFIG,
  bin,
  configFor,
  removeScratches,
  run,
  scratchProject,
} from "./test-support-scratch.ts";

afterAll(removeScratches);

const ASTRO = { dependencies: { astro: "7.4.12" } };
const manifest = (extra: object): string => JSON.stringify({ type: "module", ...extra });

const hasParser = (config: readonly Linter.Config[]): boolean =>
  config.some((entry) => entry.name === "astro/base");

async function parserFor(
  variant: EslintVariant,
  className: string,
  files: Record<string, string>,
): Promise<boolean> {
  const dir = scratchProject(files);
  return hasParser(await eslintPreset({ variant, tsconfigRootDir: dir, class: className }));
}

describe("R105: a class that maps an .astro-scoped rule gets the Astro parser where the project uses astro", () => {
  it.each(["dependencies", "devDependencies", "peerDependencies"])(
    "web-app, a react variant, adds it when astro is in %s",
    async (field) => {
      const files = { "package.json": manifest({ [field]: { astro: "7.4.12" } }) };
      expect(await parserFor("react", "web-app", files)).toBe(true);
    },
  );

  it("leaves the astro variant as it is, with its own parser", async () => {
    const [plain, astro] = [scratchProject(), scratchProject({ "package.json": manifest(ASTRO) })];
    const sizes = await Promise.all(
      [plain, astro].map(
        async (dir) =>
          (await eslintPreset({ variant: "astro", tsconfigRootDir: dir, class: "astro-site" }))
            .length,
      ),
    );
    expect(sizes[0]).toBe(sizes[1]);
    expect(await parserFor("astro", "astro-site", {})).toBe(true);
  });

  it("leaves it out when the project lists no astro, or its package.json is unreadable", async () => {
    for (const files of [
      {},
      { "package.json": manifest({ dependencies: { react: "19.0.0" } }) },
      { "package.json": "{ nope" },
      { "package.json": "null" },
    ]) {
      expect(await parserFor("react", "web-app", files)).toBe(false);
    }
  });

  it.each([
    ["ui-components", "react"],
    ["ts-library", "base"],
    ["node-service", "base"],
  ] as const)(
    "leaves it out of %s, which maps no .astro page rule, even with astro",
    async (cls, variant) => {
      expect(await parserFor(variant, cls, { "package.json": manifest(ASTRO) })).toBe(false);
    },
  );

  it(
    "web-app lints a page: client:load is flagged, an acknowledged one is not, and a script block's env is flagged",
    () => {
      const page = [
        "---",
        "const Widget = (): null => null;",
        "---",
        "<Widget client:load />",
        "<!-- webtops-ack W-28: the widget is the page's first screen -->",
        "<Widget client:load />",
        "<script>",
        "  const client: unknown = import.meta.env.SECRET;",
        "</script>",
        "",
      ].join("\n");
      const dir = scratchProject({
        "package.json": manifest(ASTRO),
        "web-tops.yaml": "class: web-app\n",
        "eslint.config.js": configFor("react"),
        "tsconfig.json": TSCONFIG,
        "src/page.astro": page,
      });
      const result = run(bin("eslint"), ["--format", "json", "src/page.astro"], dir);
      const reports: unknown = JSON.parse(result.stdout);
      const messages = JSON.stringify(reports);
      expect(messages).not.toContain('"fatal":true');
      expect(messages.split("webtops/astro-client-load-ack")).toHaveLength(2);
      expect(messages.split("webtops/public-env-only")).toHaveLength(2);
      expect(messages).not.toContain("webtops/astro-assets-image");
      expect(messages).not.toContain("webtops/astro-frontmatter-size");
    },
    REAL_TOOL_TIMEOUT,
  );
});
