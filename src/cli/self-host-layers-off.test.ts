import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { at, get } from "../config/test-support.ts";
import { parseYaml } from "../config/validate.ts";

const root = resolve(import.meta.dirname, "../..");

function yamlOf(name: string): unknown {
  const parsed = parseYaml(readFileSync(join(root, name), "utf8"));
  expect(parsed.ok, name).toBe(true);
  return parsed.ok ? parsed.value : undefined;
}

describe("G7a: the kit's own web-tops.yaml", () => {
  it.each([
    [["layers", "size_limit"], /private and publishes no package/],
    [["layers", "html_validate"], /^ts-library has no HTML output$/],
    [["layers", "axe"], /^ts-library has no pages$/],
    [["layers", "rendered"], /^ts-library has no pages to render$/],
    [["layers", "themes"], /^ts-library has no themes$/],
  ])("%j is off, and its reason says why: %s", (path, why) => {
    const entry = at(yamlOf("web-tops.yaml"), path);
    expect(get(entry, "enabled")).toBe(false);
    expect(get(entry, "reason")).toMatch(why);
  });
});
