import type { Io } from "./io.ts";

/** Stub: the step that owns this command replaces the body and keeps the signature. */
export function runGateCli(_argv: readonly string[], io: Io): Promise<number> {
  io.err("gate: lands in G2\n");
  return Promise.resolve(1);
}
