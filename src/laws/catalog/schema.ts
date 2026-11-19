import { ajv, toProblems } from "../../config/ajv.ts";
import type { Problem, Validated } from "../../config/types.ts";
import schema from "../../../schema/law.schema.json" with { type: "json" };
import type { Law } from "./types.ts";

const validate = ajv.compile<Law>(schema);

/** A conditional class must be one of the law's classes: a schema cannot say that. */
const strays = (law: Law): Problem[] =>
  (law.conditional_classes ?? [])
    .filter((name) => !law.classes.includes(name))
    .map((name) => ({ pointer: "/conditional_classes", message: `${name} is not in classes` }));

/** Validates one parsed law file against `schema/law.schema.json`, and the one rule a schema cannot state. */
export function validateLaw(value: unknown): Validated<Law> {
  if (!validate(value)) return { ok: false, problems: toProblems(validate.errors) };
  const problems = strays(value);
  return problems.length === 0 ? { ok: true, value } : { ok: false, problems };
}
