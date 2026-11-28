import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { readAckLedger } from "../acks/ledger.ts";
import { at, get, keys, matching } from "../config/test-support.ts";
import { parseYaml } from "../config/validate.ts";

const root = resolve(import.meta.dirname, "../..");

function yamlOf(name: string): unknown {
  const parsed = parseYaml(readFileSync(join(root, name), "utf8"));
  expect(parsed.ok, name).toBe(true);
  return parsed.ok ? parsed.value : undefined;
}

function jsonOf(name: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(join(root, name), "utf8"));
  return parsed;
}

const names = (list: unknown): unknown[] => keys(list).map((index) => get(list, index));

describe("G11a: the kit runs the laws layer at hard", () => {
  it("has the laws layer on, over the default laws, with the ledger at its default path", () => {
    const laws = at(yamlOf("web-tops.yaml"), ["laws"]);
    expect(get(laws, "enabled")).not.toBe(false);
    expect(get(laws, "reason")).toBeUndefined();
    expect(get(laws, "select")).toBe("default");
    expect(get(laws, "ack_ledger")).toBe(".web-tops/acks.yaml");
  });

  it("acknowledges one break, W-48 in the baseline module's public surface, with a reason and an owner", () => {
    expect(readAckLedger(root, ".web-tops/acks.yaml")).toEqual({
      ok: true,
      acks: [
        {
          law: "W-48",
          file: "src/baseline/index.ts",
          reason: matching(/only-writer\.test\.ts/),
          owner: "kit maintainers",
        },
      ],
    });
  });

  it("gives knip the data trees and the projects that gate themselves to leave alone, and no other ignore", () => {
    const knip = jsonOf("knip.json");
    expect(get(knip, "ignore")).toEqual(["fixtures/**", "probes/**", "examples/**", "poire/**"]);
    expect(get(knip, "ignoreExportsUsedInFile")).toBe(true);
  });

  it("names in knip's dependency ignores only tools package.json pins, each one the gate runs by name", () => {
    const ignored = names(at(jsonOf("knip.json"), ["ignoreDependencies"]));
    const pinned = Object.keys(pkg.devDependencies);
    expect(ignored.length).toBeGreaterThan(0);
    for (const name of ignored) expect(pinned, String(name)).toContain(name);
  });

  it("carries the rules W-16, W-17 and W-19 read in the dependency-cruiser config", () => {
    const config: unknown = createRequire(import.meta.url)(join(root, ".dependency-cruiser.cjs"));
    const rules = names(get(config, "forbidden")).map((rule) => get(rule, "name"));
    expect(rules).toEqual(
      expect.arrayContaining(["no-circular", "no-unresolvable", "no-optional-peer-import"]),
    );
    expect(rules).not.toContain("not-to-unresolvable");
  });

  it("keeps the type-aware rules at error for a page's script block, which no config file is", async () => {
    const config: unknown = await new ESLint({ cwd: root }).calculateConfigForFile(
      join(root, "src/__webtops_probe__.astro/0.js"),
    );
    expect(at(config, ["rules", "@typescript-eslint/no-unsafe-assignment"])).toEqual([2]);
    const plain: unknown = await new ESLint({ cwd: root }).calculateConfigForFile(
      join(root, "eslint.config.js"),
    );
    expect(at(plain, ["rules", "@typescript-eslint/no-unsafe-assignment"])).toEqual([0]);
  });
});
