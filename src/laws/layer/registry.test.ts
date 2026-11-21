import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { attwReader } from "../readers/attw.ts";
import { bunReader } from "../readers/bun.ts";
import { depcruiseReader } from "../readers/depcruise.ts";
import { eslintReader } from "../readers/eslint.ts";
import { publintReader } from "../readers/publint.ts";
import { tscReader } from "../readers/tsc.ts";
import { defaultReaders } from "./readers.ts";

/**
 * G9: each tool's reader is registered under the tool the laws name, so the laws layer reads it. The laws are read from
 * their files here, not through the catalog loader, so the test runs no code of the layer.
 */

const LAWS = resolve(import.meta.dirname, "../../../laws");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The tools a judged law's rules name, read from `laws/W-NN.yaml`. */
function toolsOf(file: string): string[] {
  const law: unknown = parse(readFileSync(join(LAWS, file), "utf8"));
  if (!isRecord(law) || law["judged"] === "no") return [];
  return list(law["rules"])
    .filter(isRecord)
    .map((rule) => String(rule["tool"]));
}

const judgedTools = (): Set<string> =>
  new Set(
    readdirSync(LAWS)
      .filter((file) => /^W-\d+\.yaml$/u.test(file))
      .flatMap(toolsOf),
  );

describe("the registry of the laws layer's readers", () => {
  it("holds each reader under the tool whose rules it reads", () => {
    const readers = defaultReaders();
    expect(readers.get("attw")).toBe(attwReader);
    expect(readers.get("bun")).toBe(bunReader);
    expect(readers.get("dependency-cruiser")).toBe(depcruiseReader);
    expect(readers.get("eslint")).toBe(eslintReader);
    expect(readers.get("publint")).toBe(publintReader);
    expect(readers.get("tsc")).toBe(tscReader);
  });

  it("names the tools a judged law maps that have no reader yet: a law that maps one is not evaluated for it", () => {
    const readers = defaultReaders();
    const unread = [...judgedTools()].filter((tool) => !readers.has(tool)).sort();
    // G9's second half registers knip, lock and secretlint; W-27, W-20 and W-21 and W-22 read built pages, in later steps.
    expect(unread).toEqual([
      "astro-check",
      "axe",
      "html-validate",
      "knip",
      "lock",
      "secretlint",
      "stylelint",
    ]);
  });
});
