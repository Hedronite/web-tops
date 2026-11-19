import { describe, expect, it } from "vitest";
import { loadProfile } from "../init/profile.ts";
import { CATALOG_DIR, LAW_CLASSES, loadCatalog, select } from "../laws/catalog/index.ts";
import type { Law, LawClass } from "../laws/catalog/index.ts";
import plugin from "../../packages/eslint-plugin-webtops/src/index.ts";
import { eslintPreset } from "./eslint.js";

const PREFIX = "webtops/";

/** The laws of the catalog, as the catalog loads them. */
function lawsOf(): readonly Law[] {
  const catalog = loadCatalog(CATALOG_DIR);
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.problems));
  return catalog.laws;
}

/** The plugin's rules, named as a config names them. */
const IMPLEMENTED = new Set(Object.keys(plugin.rules ?? {}).map((name) => `${PREFIX}${name}`));

/**
 * The `webtops/*` rules a class's laws map to the ESLint reader that the plugin has built. A law
 * can name a rule that a later step builds (the Astro rules of W-28, W-30 and W-31); the step that
 * adds the rule to the plugin must also enable it, or this test fails.
 */
function mappedRules(laws: readonly Law[], cls: LawClass): string[] {
  return select(laws, { cls, required: false })
    .flatMap((law) => law.rules)
    .filter((rule) => rule.tool === "eslint" && IMPLEMENTED.has(rule.name))
    .map((rule) => rule.name)
    .sort();
}

/** The `webtops/*` rules the class's preset sets to error. */
async function enabledRules(cls: LawClass): Promise<string[]> {
  const loaded = loadProfile(cls);
  if (!loaded.ok) throw new Error(loaded.error);
  const config = await eslintPreset({ variant: loaded.profile.eslint, tsconfigRootDir: "<p>" });
  const names = config.flatMap((entry) =>
    Object.entries(entry.rules ?? {})
      .filter(([name, setting]) => name.startsWith(PREFIX) && setting === "error")
      .map(([name]) => name),
  );
  return [...new Set(names)].sort();
}

describe("R98: a class's preset enables exactly the plugin rules its laws map", () => {
  const laws = lawsOf();

  it.each(LAW_CLASSES)(
    "%s: the enabled webtops/* rules are the mapped laws' rules",
    async (cls) => {
      const mapped = mappedRules(laws, cls);
      expect(mapped.length).toBeGreaterThan(0);
      expect(await enabledRules(cls)).toEqual(mapped);
    },
  );

  it("holds the split the laws make: the Tailwind rule only for astro-site and web-app", async () => {
    const withTailwind: LawClass[] = [];
    for (const cls of LAW_CLASSES) {
      if ((await enabledRules(cls)).includes("webtops/complete-tailwind-classes")) {
        withTailwind.push(cls);
      }
    }
    expect(withTailwind).toEqual(["astro-site", "web-app"]);
  });
});
