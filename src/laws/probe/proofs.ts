/**
 * The compiler diagnostics each flag raises, by code. A bad twin proves a flag when its marker names one of these and
 * the compiler reports it. Several flags raise the same code (`TS18048` is both `strictNullChecks` and
 * `noUncheckedIndexedAccess`), so a twin is written to break one flag only: it compiles with the other on.
 */
function flagCodes(): ReadonlyMap<string, readonly string[]> {
  return new Map([
    ["noImplicitAny", ["TS7006"]],
    ["strictNullChecks", ["TS18047", "TS18048"]],
    ["strictFunctionTypes", ["TS2322"]],
    ["strictBindCallApply", ["TS2345"]],
    ["strictPropertyInitialization", ["TS2564"]],
    ["noImplicitThis", ["TS2683"]],
    ["useUnknownInCatchVariables", ["TS18046"]],
    ["noUncheckedIndexedAccess", ["TS18048"]],
    ["exactOptionalPropertyTypes", ["TS2375", "TS2379"]],
    ["noImplicitOverride", ["TS4114"]],
    ["noFallthroughCasesInSwitch", ["TS7029"]],
    ["verbatimModuleSyntax", ["TS1484"]],
    ["isolatedModules", ["TS1205"]],
    ["erasableSyntaxOnly", ["TS1294"]],
  ]);
}

/**
 * `strict` turns the family on as one, so it is proven by any member's code. `alwaysStrict` and
 * `strictBuiltinIteratorReturn` have no twin: an ES module is always strict, and the second is read from the config.
 */
function strictFamily(): readonly string[] {
  return [
    "noImplicitAny",
    "strictNullChecks",
    "strictFunctionTypes",
    "strictBindCallApply",
    "strictPropertyInitialization",
    "noImplicitThis",
    "useUnknownInCatchVariables",
  ];
}

/** The codes a flag raises: none for a name that is not a flag. */
export function codesOf(flag: string): readonly string[] {
  if (flag === "strict") {
    return strictFamily().flatMap(codesOf);
  }
  return flagCodes().get(flag) ?? [];
}

/**
 * Whether a finding or a marker named `id` is evidence for `proof`: the same rule, the same rule under a plugin
 * prefix (`@typescript-eslint/no-explicit-any` for `no-explicit-any`), or a compiler code of a flag.
 */
export function proves(proof: string, id: string): boolean {
  return proof === id || id.endsWith(`/${proof}`) || codesOf(proof).includes(id);
}

/**
 * Whether a marker's name is evidence for a law's proof: the proof itself, a marker that drops the plugin prefix of a
 * proof that has one (`no-explicit-any` for `@typescript-eslint/no-explicit-any`), a flag's own name or code, or any
 * member of the strict family for `strict`.
 */
export const provenBy = (proof: string, named: string): boolean =>
  proves(proof, named) ||
  proof.endsWith(`/${named}`) ||
  (proof === "strict" && strictFamily().includes(named));
