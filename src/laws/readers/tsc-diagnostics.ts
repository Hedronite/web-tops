import { isRecord, parseJson, records } from "../../layers/hygiene/tooling.ts";

/**
 * The compiler diagnostics each flag raises, by TypeScript error code. A diagnostic with one of these codes means the
 * flag is live and a file breaks it, so the law that maps the flag is refused, and never passed. A code that many
 * errors share (`TS2322`, `TS2345`, `TS2339`) names no flag, so it belongs to no law: gate 1's `tsc` fails on it
 * all the same. `strictFunctionTypes`, `strictBindCallApply`, `alwaysStrict` and `strictBuiltinIteratorReturn` raise
 * only such codes, and are judged by their config alone.
 */
function flagDiagnostics(): ReadonlyMap<string, readonly string[]> {
  return new Map([
    [
      "noImplicitAny",
      [
        "TS7005",
        "TS7006",
        "TS7008",
        "TS7010",
        "TS7011",
        "TS7015",
        "TS7016",
        "TS7017",
        "TS7018",
        "TS7019",
        "TS7022",
        "TS7023",
        "TS7024",
        "TS7031",
        "TS7034",
        "TS7035",
        "TS7053",
      ],
    ],
    [
      "strictNullChecks",
      ["TS2531", "TS2532", "TS2533", "TS2721", "TS2722", "TS2723", "TS18047", "TS18048", "TS18049"],
    ],
    ["strictPropertyInitialization", ["TS2564", "TS2565"]],
    ["noImplicitThis", ["TS2683"]],
    ["useUnknownInCatchVariables", ["TS18046"]],
    ["noUncheckedIndexedAccess", ["TS18048"]],
    ["exactOptionalPropertyTypes", ["TS2375", "TS2379", "TS2412"]],
    ["noImplicitOverride", ["TS4114", "TS4115", "TS4116", "TS4119", "TS4120"]],
    ["noFallthroughCasesInSwitch", ["TS7029"]],
    ["verbatimModuleSyntax", ["TS1484", "TS1485"]],
    ["isolatedModules", ["TS1205", "TS1208", "TS2748"]],
    ["erasableSyntaxOnly", ["TS1294"]],
  ]);
}

/** The codes a flag raises: none for a flag whose errors are all shared with others. */
export const codesOf = (flag: string): readonly string[] => flagDiagnostics().get(flag) ?? [];

const codeOf = (entry: Record<string, unknown>): string[] => {
  const code = entry["code"];
  return typeof code === "string" ? [code] : [];
};

const countOf = (codes: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const code of codes) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
};

/**
 * Gate 1's `tsc` diagnostics, counted by code: the artifact `tsc-diagnostics` the hygiene layer writes is an array
 * of `{ file, line, column, code, message }`, one for each diagnostic, `[]` when the compile was clean. Undefined when
 * the text is not that.
 */
export function readDiagnostics(text: string | undefined): ReadonlyMap<string, number> | undefined {
  const value = parseJson(text);
  if (!Array.isArray(value) || !value.every(isRecord)) {
    return undefined;
  }
  return countOf(records(value).flatMap(codeOf));
}
