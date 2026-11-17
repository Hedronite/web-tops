import type { Io } from "./io.ts";

/** Stub: the step that owns this command replaces the body and keeps the signature. */
export function runDoctorCli(_argv: readonly string[], io: Io): Promise<number> {
  io.err("doctor: lands in G6\n");
  return Promise.resolve(1);
}
