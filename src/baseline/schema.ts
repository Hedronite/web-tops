import { ajv, toProblems } from "../config/ajv.ts";
import type { Problem, Validated } from "../config/types.ts";
import schema from "../../schema/baseline.schema.json" with { type: "json" };
import type { Baseline } from "./types.ts";

const validate = ajv.compile<Baseline>(schema);

function coverageProblems(value: Baseline): readonly Problem[] {
  return Object.entries(value.coverage)
    .filter(([, entry]) => entry.lines_hit > entry.lines_found)
    .map(([name]) => ({ pointer: `/coverage/${name}`, message: "lines_hit is above lines_found" }));
}

function censusProblems(value: Baseline): readonly Problem[] {
  return Object.entries(value.census)
    .filter(([, entry]) => entry.count !== entry.fingerprints.length)
    .map(([kind]) => ({
      pointer: `/census/${kind}`,
      message: "count is not the number of fingerprints",
    }));
}

/** Validates a parsed baseline against `schema/baseline.schema.json`, and the two rules a schema cannot state. */
export function validateBaseline(value: unknown): Validated<Baseline> {
  if (!validate(value)) return { ok: false, problems: toProblems(validate.errors) };
  const problems = [...coverageProblems(value), ...censusProblems(value)];
  return problems.length === 0 ? { ok: true, value } : { ok: false, problems };
}
