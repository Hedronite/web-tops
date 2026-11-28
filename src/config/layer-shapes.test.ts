import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toGateConfig } from "../gate/adapter.ts";
import { fixture, get } from "./test-support.ts";
import { loadConfig, parseConfig } from "./validate.ts";

const spec = readFileSync(join(import.meta.dirname, "../../WEB_TOPS.md"), "utf8");

describe("G3c: layers.rendered and layers.themes have reserved shapes", () => {
  it("validates a config that sets every key of both", () => {
    const loaded = loadConfig(fixture("valid/rendered-themes.yaml"));
    expect(loaded.ok).toBe(true);
    const layers = get(get(loaded, "value"), "layers");
    expect(get(get(layers, "rendered"), "widths")).toEqual([1280, 768, 320]);
    expect(get(get(get(layers, "themes"), "switch"), "mechanism")).toBe("attribute");
  });

  it("leaves the shapes optional: a bare `enabled` entry still validates", () => {
    const head = 'protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: astro-site\n';
    expect(parseConfig(`${head}layers: { rendered: {}, themes: { enabled: true } }\n`).ok).toBe(
      true,
    );
  });

  it("changes nothing the gate runs: the shapes are validated and unused until M5", () => {
    const head = 'protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: astro-site\nenforce: hard\n';
    const bare = parseConfig(head);
    const shaped = loadConfig(fixture("valid/rendered-themes.yaml"));
    expect(bare.ok && shaped.ok).toBe(true);
    if (!bare.ok || !shaped.ok) return;
    expect(toGateConfig(shaped.value, { dependsOnAstro: true })).toEqual(
      toGateConfig(
        { ...bare.value, package: shaped.value.package, version: shaped.value.version },
        { dependsOnAstro: true },
      ),
    );
  });

  it.each(["skip_private", "routes", "widths", "reduced_motion", "mechanism", "schemes", "tokens"])(
    "section 9 names %s",
    (key) => {
      const section9 = spec.slice(spec.indexOf("## 9."), spec.indexOf("## 10."));
      expect(section9).toContain(key);
    },
  );

  it.each(["skip_private", "routes", "widths", "reduced_motion", "mechanism", "schemes", "tokens"])(
    "the section 18 sketch names %s",
    (key) => {
      const section18 = spec.slice(spec.indexOf("## 18."), spec.indexOf("## 19."));
      expect(section18).toContain(key);
    },
  );
});
