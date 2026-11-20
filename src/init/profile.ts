import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import { parse } from "yaml";
import type { Profile } from "../config/profiles.ts";
import { PROFILES, profileFor } from "../config/profiles.ts";

/** The classes that have a launch profile: the rows of the one class table (src/config/profiles.ts). */
export const LAUNCH_CLASSES: readonly string[] = PROFILES.map((profile) => profile.class);

/** Which plugin set `eslint.config.js` adds on top of the base law rules. */
export type EslintVariant = "base" | "react" | "astro";

/** The drop-in data for one class (the floors and mapped layers live in the class table; see the agreement test): floors, the tools its enabled layers run, and what M1 leaves off. */
export interface DropIn {
  readonly class: string;
  readonly coverage_floor: number;
  readonly crap_cap: number;
  readonly survivors_max: number;
  readonly js_budget: string;
  readonly playwright: boolean;
  readonly eslint: EslintVariant;
  readonly tools: readonly string[];
  /** Tools the class adds only where the project depends on astro. */
  readonly astro_tools?: readonly string[];
  /** Layer key to the reason it is written `enabled: false`. */
  readonly disabled: Readonly<Record<string, string>>;
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "class",
    "coverage_floor",
    "crap_cap",
    "survivors_max",
    "js_budget",
    "playwright",
    "eslint",
    "tools",
    "disabled",
  ],
  properties: {
    class: { type: "string", minLength: 1 },
    coverage_floor: { type: "number", minimum: 0, maximum: 100 },
    crap_cap: { type: "number", minimum: 1 },
    survivors_max: { type: "integer", minimum: 0 },
    js_budget: { type: "string", minLength: 1 },
    playwright: { type: "boolean" },
    eslint: { enum: ["base", "react", "astro"] },
    tools: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    astro_tools: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    disabled: { type: "object", additionalProperties: { type: "string", minLength: 1 } },
  },
} as const;

const validate = new Ajv().compile<DropIn>(schema);

export const PROFILES_DIR = resolve(import.meta.dirname, "../../profiles");

export type ProfileLoad =
  | { readonly ok: true; readonly profile: DropIn; readonly table: Profile }
  | { readonly ok: false; readonly error: string };

type Read =
  { readonly ok: true; readonly doc: unknown } | { readonly ok: false; readonly error: string };

function readProfileFile(dir: string, className: string): Read {
  try {
    return { ok: true, doc: parse(readFileSync(resolve(dir, `${className}.yaml`), "utf8")) };
  } catch (error) {
    return { ok: false, error: `profiles/${className}.yaml is unreadable: ${String(error)}` };
  }
}

function checkProfile(className: string, table: Profile, doc: unknown): ProfileLoad {
  if (!validate(doc)) {
    return {
      ok: false,
      error: `profiles/${className}.yaml is invalid: ${JSON.stringify(validate.errors)}`,
    };
  }
  if (doc.class !== className) {
    return { ok: false, error: `profiles/${className}.yaml declares class "${doc.class}"` };
  }
  return { ok: true, profile: doc, table };
}

const tableFor = (className: string | undefined): Profile | undefined =>
  className === undefined ? undefined : profileFor(className);

const noProfile = (className: string | undefined): string =>
  className === undefined || className === ""
    ? "no class given"
    : `no launch profile for class "${className}"`;

/**
 * Loads `profiles/<className>.yaml` from `dir` with the class's row of the one class table; only a
 * launch class has both.
 */
export function loadProfile(
  className: string | undefined,
  dir: string = PROFILES_DIR,
): ProfileLoad {
  const table = tableFor(className);
  if (table === undefined) return { ok: false, error: noProfile(className) };
  const read = readProfileFile(dir, table.class);
  return read.ok ? checkProfile(table.class, table, read.doc) : read;
}
