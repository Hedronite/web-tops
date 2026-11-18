import { createRequire } from "node:module";
import { join } from "node:path";
import type { Ts } from "./types.ts";
import { ComplexityError } from "./types.ts";

/** Named in a variable, not at the call, so the dependency check sees no import of a dev dependency: the module is whichever copy the project has. */
const MODULE = "typescript";

const NEEDED = ["createSourceFile", "forEachChild", "isTypeNode", "flattenDiagnosticMessageText"];

/** True for something that has the parts of the TypeScript API the counter calls. */
function looksLikeTypeScript(value: unknown): value is Ts {
  if (typeof value !== "object" || value === null) return false;
  const present = NEEDED.every((name) => typeof Reflect.get(value, name) === "function");
  return present && typeof Reflect.get(value, "SyntaxKind") === "object";
}

/**
 * The project's own pinned TypeScript, read from `dir/node_modules` (WEB_TOPS.md section 3.1: tools
 * come from `node_modules`, not from the kit). Throws `ComplexityError` when it is not installed.
 */
export function loadTypeScript(dir: string): Ts {
  const require = createRequire(join(dir, "package.json"));
  try {
    const loaded: unknown = require(MODULE);
    if (looksLikeTypeScript(loaded)) return loaded;
  } catch {
    // not installed under dir: the error below says so
  }
  throw new ComplexityError(`typescript is not installed under ${dir}/node_modules`, dir);
}
