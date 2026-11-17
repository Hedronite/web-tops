import type { Io } from "./io.ts";

/** Stub: the step that owns this command replaces the body and keeps the signature. */
export function runLockCli(_argv: readonly string[], io: Io): Promise<number> {
  io.err("lock: lands in G6\n");
  return Promise.resolve(1);
}
