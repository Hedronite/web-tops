import type { Io } from "./io.ts";

/** Stub: the step that owns this command replaces the body and keeps the signature. */
export function runInitCli(_argv: readonly string[], io: Io): Promise<number> {
  io.err("init: lands in G5\n");
  return Promise.resolve(1);
}
