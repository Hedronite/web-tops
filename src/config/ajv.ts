import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject } from "ajv";
import core from "../../schema/core.schema.json" with { type: "json" };
import type { Problem } from "./types.ts";

/** The one validator: JSON Schema 2020-12, strict, schema defaults filled in. */
export const ajv = new Ajv2020({ allErrors: true, strict: true, useDefaults: true });

/** The shared core (verdicts, modes, failure table) is registered first: the report and config schemas `$ref` it. */
ajv.addSchema(core);

function token(text: string): string {
  return text.replaceAll("~", "~0").replaceAll("/", "~1");
}

function param(error: ErrorObject, key: string): unknown {
  const value: unknown = Reflect.get(error.params, key);
  return value;
}

function pointerOf(error: ErrorObject): string {
  const names: Readonly<Record<string, string>> = {
    required: "missingProperty",
    additionalProperties: "additionalProperty",
    unevaluatedProperties: "unevaluatedProperty",
  };
  const key = names[error.keyword];
  const name = key === undefined ? undefined : param(error, key);
  return typeof name === "string" ? `${error.instancePath}/${token(name)}` : error.instancePath;
}

function allowedOf(error: ErrorObject): unknown {
  return error.keyword === "const" ? param(error, "allowedValue") : param(error, "allowedValues");
}

function messageOf(error: ErrorObject): string {
  if (error.keyword === "contains") return "a required item is missing";
  const base = error.message ?? `fails ${error.keyword}`;
  const allowed = allowedOf(error);
  return allowed === undefined ? base : `${base}: ${JSON.stringify(allowed)}`;
}

/** The noise from `if`, and from the items a `contains` tried, says nothing a reader can use. */
function isNoise(error: ErrorObject): boolean {
  return error.keyword === "if" || error.schemaPath.includes("/contains/");
}

function toProblem(
  error: ErrorObject,
  describe: (error: ErrorObject) => string | undefined,
): Problem {
  return { pointer: pointerOf(error), message: describe(error) ?? messageOf(error) };
}

/**
 * Ajv errors as pointer-and-message problems. The noise from `if` and from the items a `contains`
 * tried is dropped; duplicates are merged. `describe` may give a better message for an error.
 */
export function toProblems(
  errors: readonly ErrorObject[] | null | undefined,
  describe: (error: ErrorObject) => string | undefined = () => undefined,
): readonly Problem[] {
  const seen = new Map<string, Problem>();
  for (const error of (errors ?? []).filter((candidate) => !isNoise(candidate))) {
    const problem = toProblem(error, describe);
    seen.set(`${problem.pointer}\u0000${problem.message}`, problem);
  }
  return [...seen.values()];
}

export function fail(
  pointer: string,
  message: string,
): { ok: false; problems: readonly Problem[] } {
  return { ok: false, problems: [{ pointer, message }] };
}
