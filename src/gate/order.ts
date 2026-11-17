import type { GateRef } from "../report/types.ts";

/** WEB_TOPS.md section 3.1: gates 1 to 6 in order, then custom layers, then laws, which runs at the tier of the layers it reads and executes last. */
function rank(gate: GateRef): number {
  return typeof gate === "number" ? gate : 99;
}

export function compareGates(a: GateRef, b: GateRef): number {
  return rank(a) - rank(b);
}
