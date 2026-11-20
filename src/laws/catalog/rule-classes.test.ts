import astro from "eslint-plugin-astro";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "./load.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const PREFIX = "astro/jsx-a11y/";

function w22Rules() {
  const loaded = loadCatalog(join(ROOT, "laws"));
  if (!loaded.ok) throw new Error(loaded.problems.map((found) => found.message).join("; "));
  const found = loaded.laws.find((law) => law.id === "W-22");
  if (found === undefined) throw new Error("no W-22");
  return found.rules;
}

const levelOf = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting);

/** The astro a11y rules its strict config turns on: the plugin says which they are. */
const ENABLED = astro.configs["flat/jsx-a11y-strict"]
  .flatMap((entry) => Object.entries(entry.rules ?? {}))
  .filter(
    ([name, setting]) => name.startsWith(PREFIX) && ![0, "off"].includes(String(levelOf(setting))),
  )
  .map(([name]) => name)
  .sort();

describe("R106: W-22 maps the astro a11y rules to astro-site only", () => {
  it("lists exactly the 31 rules the plugin's strict a11y config enables, each for astro-site", () => {
    const mapped = w22Rules().filter((rule) => rule.name.startsWith(PREFIX));
    expect(mapped.map((rule) => rule.name).sort()).toEqual(ENABLED);
    expect(ENABLED).toHaveLength(31);
    for (const rule of mapped) {
      expect(rule, rule.name).toMatchObject({ tool: "eslint", classes: ["astro-site"] });
    }
  });

  it("leaves the jsx-a11y-x rules, and the built-page checks, for every class the law maps", () => {
    const others = w22Rules().filter((rule) => !rule.name.startsWith(PREFIX));
    expect(others.map((rule) => rule.name)).toEqual([
      "jsx-a11y-x/alt-text",
      "jsx-a11y-x/label-has-associated-control",
      "jsx-a11y-x/no-static-element-interactions",
      "jsx-a11y-x/click-events-have-key-events",
      "jsx-a11y-x/anchor-is-valid",
      "a11y",
      "axe",
    ]);
    for (const rule of others) expect(rule.classes, rule.name).toBeUndefined();
  });
});
