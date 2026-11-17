import type { GateRef } from "../report/types.ts";

/** WEB_TOPS.md section 3.1: gates 1 to 6 in order, then custom layers, then laws, which is tier 0 but executes last. */
function rank(gate: GateRef): number {
  if (typeof gate === "number") {
    return gate;
  }
  return gate === "custom" ? 6.5 : 99;
}

export function compareGates(a: GateRef, b: GateRef): number {
  return rank(a) - rank(b);
}
