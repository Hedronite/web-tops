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
    [["laws"], "M3"],
    [["layers", "size_limit"], "M4"],
    [["layers", "html_validate"], "M4"],
    [["layers", "axe"], "M4"],
    [["layers", "rendered"], "M4"],
    [["layers", "themes"], "M4"],
  ])("%j is off, and its reason names %s", (path, milestone) => {
    const entry = at(yamlOf("web-tops.yaml"), path);
    expect(get(entry, "enabled")).toBe(false);
    expect(get(entry, "reason")).toMatch(new RegExp(`^${milestone}\\b`));
  });
});
