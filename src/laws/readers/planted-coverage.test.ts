import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { defaultReaders } from "../layer/readers.ts";

/**
 * One planted violation per law: a judged law whose rules name only tools that have a reader is planted, by its id. The
 * plants are in `planted.test.ts` (the results gate 1 keeps, and the lock) and in `layer/real-tools-e2e.test.ts` (the
 * real tools); W-26's are in `stylelint.test.ts` and `stylelint-real.test.ts`, W-27's in `astro-check.test.ts`. A law
 * that names axe or html-validate (W-20, W-21, W-22) has a tool with no reader yet, so none is listed. The law files are read here, not through the catalog
 * loader, so the test runs no code of the layer but the registry.
 */

const LAWS = resolve(import.meta.dirname, "../../../laws");

/** The laws with a plant: add a law's id here with its plant, or the test below fails. */
const PLANTED = [
  "W-16",
  "W-17",
  "W-18",
  "W-19",
  "W-26",
  "W-27",
  "W-38",
  "W-39",
  "W-40",
  "W-41",
  "W-48",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A judged law of `laws/W-NN.yaml` with the tools its rules name. */
function judgedLaws(): { id: string; tools: string[] }[] {
  return readdirSync(LAWS)
    .filter((file) => /^W-\d+\.yaml$/u.test(file))
    .flatMap((file) => {
      const law: unknown = parse(readFileSync(join(LAWS, file), "utf8"));
      if (!isRecord(law) || law["judged"] === "no") return [];
      const tools = list(law["rules"])
        .filter(isRecord)
        .map((rule) => String(rule["tool"]));
      return [{ id: String(law["id"]), tools }];
    });
}

describe("every law the registered readers can judge has a planted violation", () => {
  it("a judged law whose rules name only tools with a reader is planted, by its id", () => {
    // the lint and compiler laws are judged from the project's config, and their plants are the probe's twins
    const here = new Set(
      [...defaultReaders().keys()].filter((tool) => !["eslint", "tsc"].includes(tool)),
    );
    const mine = judgedLaws()
      .filter((law) => law.tools.length > 0 && law.tools.every((tool) => here.has(tool)))
      .map((law) => law.id);
    expect(mine.filter((id) => !PLANTED.includes(id))).toEqual([]);
    expect(mine.length).toBeGreaterThanOrEqual(PLANTED.length);
  });
});
