import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseDocument } from "yaml";
import { ajv, fail, toProblems } from "./ajv.ts";
import { runSemanticChecks, type SemanticContext } from "./semantic.ts";
import schema from "../../schema/web-tops.schema.json" with { type: "json" };
import type { Validated, WebTopsConfig } from "./types.ts";

const validate = ajv.compile<WebTopsConfig>(schema);

/**
 * Validates a parsed document against `schema/web-tops.schema.json`. Schema defaults (enforce,
 * baseline, report.path) are filled into `doc` in place, so pass a document you own.
 */
export function validateConfig(doc: unknown): Validated<WebTopsConfig> {
  if (validate(doc)) return { ok: true, value: doc };
  return { ok: false, problems: toProblems(validate.errors) };
}

/**
 * Parses YAML text into its plain JS value, and nothing more: no schema, no semantic checks. So
 * `doctor` and `report` can read `class`, `toolchain` or `report.path` from a config that fails
 * `check`. A syntax error or a duplicate key is a problem at "".
 */
export function parseYaml(text: string): Validated<unknown> {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    return {
      ok: false,
      problems: document.errors.map((error) => ({
        pointer: "",
        message: error.message.split("\n")[0] ?? error.message,
      })),
    };
  }
  try {
    const value: unknown = document.toJS();
    return { ok: true, value };
  } catch (error: unknown) {
    return fail("", error instanceof Error ? error.message : "cannot read the YAML document");
  }
}

/** Parses YAML text, then validates it against the schema. */
export function parseConfig(text: string): Validated<WebTopsConfig> {
  const parsed = parseYaml(text);
  return parsed.ok ? validateConfig(parsed.value) : parsed;
}

/** Reads and validates a `web-tops.yaml`. A file that cannot be read is a problem at "". */
export function loadConfig(path: string): Validated<WebTopsConfig> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    return fail("", `cannot read ${path}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  return parseConfig(text);
}

/**
 * `webtops check` and the start of `gate`: schema first, then the semantic checks (section 12).
 * Paths in the config, such as the baseline, resolve against the config file's directory.
 */
export function checkConfigFile(
  path: string,
  context: SemanticContext = { cwd: dirname(resolve(path)) },
): Validated<WebTopsConfig> {
  const loaded = loadConfig(path);
  if (!loaded.ok) return loaded;
  const problems = runSemanticChecks(loaded.value, context);
  return problems.length === 0 ? loaded : { ok: false, problems };
}
