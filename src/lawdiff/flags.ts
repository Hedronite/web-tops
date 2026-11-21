import type { Project } from "../laws/readers/tsc-judge.ts";
import type { Ranked } from "./types.ts";

/** The compiler flags W-04 holds, where `true` is the stricter value. */
function held(): readonly string[] {
  return [
    "strict",
    "noImplicitAny",
    "strictNullChecks",
    "strictFunctionTypes",
    "strictBindCallApply",
    "strictPropertyInitialization",
    "noImplicitThis",
    "useUnknownInCatchVariables",
    "alwaysStrict",
    "strictBuiltinIteratorReturn",
    "noUncheckedIndexedAccess",
    "exactOptionalPropertyTypes",
    "noImplicitOverride",
    "noFallthroughCasesInSwitch",
    "verbatimModuleSyntax",
    "isolatedModules",
    "erasableSyntaxOnly",
  ];
}

/** The flags `strict` turns on when they are not set themselves. */
function strictFamily(): ReadonlySet<string> {
  return new Set(held().slice(1, 10));
}

/** A flag as the compiler reads it: its own value, else `strict`'s for a member of its family. */
function effective(options: Readonly<Record<string, unknown>>, flag: string): unknown {
  const own = options[flag];
  return own === undefined && strictFamily().has(flag) ? options["strict"] : own;
}

const rankOf = (value: unknown): Ranked =>
  value === true
    ? { shown: "true", rank: 1 }
    : { shown: value === false ? "false" : "unset", rank: 0 };

/** The held flags of every checked project, by `<tsconfig>: <flag>`. */
export function flagsOf(projects: readonly Project[]): Map<string, Ranked> {
  return new Map(
    projects.flatMap((project) =>
      held().map((flag): [string, Ranked] => [
        `${project.config}: ${flag}`,
        rankOf(effective(project.options, flag)),
      ]),
    ),
  );
}
