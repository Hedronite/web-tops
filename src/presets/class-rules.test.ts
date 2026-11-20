import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import plugin from "../../packages/eslint-plugin-webtops/src/index.ts";
import { eslintPreset } from "./eslint.js";
import type { EslintVariant } from "./eslint.js";

const ROOT = resolve(import.meta.dirname, "../..");
const PREFIX = "webtops/";
const CLASSES = ["ts-library", "ui-components", "astro-site", "web-app", "node-service"];

function yamlOf(path: string): unknown {
  return parse(readFileSync(join(ROOT, path), "utf8"));
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function list(value: unknown, key: string): unknown[] {
  const found = field(value, key);
  return Array.isArray(found) ? found : [];
}

/** The variant a class's drop-in profile names. */
function variantOf(cls: string): EslintVariant {
  const named = field(yamlOf(`profiles/${cls}.yaml`), "eslint");
  if (named === "base" || named === "react" || named === "astro") return named;
  throw new Error(`profiles/${cls}.yaml names no variant`);
}

/** The plugin's rules, named as a config names them. */
const IMPLEMENTED = new Set(Object.keys(plugin.rules ?? {}).map((name) => `${PREFIX}${name}`));

/**
 * The `webtops/*` rules the laws a class maps give the ESLint reader, read from the law files. A law
 * can name a rule that a later step builds; the step that adds the rule to the plugin must also
 * enable it, or this test fails.
 */
function mappedRules(cls: string): string[] {
  const names = readdirSync(join(ROOT, "laws"))
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => yamlOf(`laws/${file}`))
    .filter((law) => list(law, "classes").includes(cls))
    .flatMap((law) => list(law, "rules"))
    .filter((rule) => field(rule, "tool") === "eslint")
    .map((rule) => field(rule, "name"))
    .filter((name): name is string => typeof name === "string" && IMPLEMENTED.has(name));
  return names.sort();
}

async function enabledRules(cls: string): Promise<string[]> {
  const config = await eslintPreset({
    variant: variantOf(cls),
    tsconfigRootDir: "<project>",
    class: cls,
  });
  const names = config.flatMap((entry) =>
    Object.entries(entry.rules ?? {})
      .filter(([name, setting]) => name.startsWith(PREFIX) && setting === "error")
      .map(([name]) => name),
  );
  return [...new Set(names)].sort();
}

describe("R98: a class's preset enables exactly the plugin rules its laws map", () => {
  it.each(CLASSES)("%s: the enabled webtops/* rules are the mapped laws' rules", async (cls) => {
    const mapped = mappedRules(cls);
    expect(mapped.length).toBeGreaterThan(0);
    expect(await enabledRules(cls)).toEqual(mapped);
  });

  it("holds the split the laws make: the Tailwind rule only for astro-site and web-app", async () => {
    const withTailwind: string[] = [];
    for (const cls of CLASSES) {
      if ((await enabledRules(cls)).includes("webtops/complete-tailwind-classes")) {
        withTailwind.push(cls);
      }
    }
    expect(withTailwind).toEqual(["astro-site", "web-app"]);
  });
});
