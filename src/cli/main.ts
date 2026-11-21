#!/usr/bin/env bun
import { runAcksCli } from "./acks.ts";
import { runBaselineCli } from "./baseline.ts";
import { runCheckCli } from "./check.ts";
import { runDoctorCli } from "./doctor.ts";
import { runGateCli } from "./gate.ts";
import { runInitCli } from "./init.ts";
import { stdio, type Io } from "./io.ts";
import { runLawsCli } from "./laws.ts";
import { runLockCli } from "./lock.ts";
import { runReportCli } from "./report.ts";
import { runSurvivorsCli } from "./survivors.ts";
import { runVersionCli } from "./version.ts";

export type { Io } from "./io.ts";

type Command = (argv: readonly string[], io: Io) => Promise<number>;

const COMMANDS: ReadonlyMap<string, Command> = new Map<string, Command>([
  ["baseline", runBaselineCli],
  ["check", runCheckCli],
  ["doctor", runDoctorCli],
  ["gate", runGateCli],
  ["init", runInitCli],
  ["lock", runLockCli],
  ["report", runReportCli],
  ["survivors", runSurvivorsCli],
  ["version", runVersionCli],
  ["laws", runLawsCli],
  ["acks", runAcksCli],
]);

const USAGE = `usage: webtops <command>\ncommands: ${[...COMMANDS.keys()].join(", ")}\n`;

/**
 * Runs one `webtops` invocation and returns its exit code (WEB_TOPS.md section 12), at once for
 * a usage error or as a promise for a command. This is the only place commands are registered.
 */
export function run(argv: readonly string[], io: Io): number | Promise<number> {
  const [name, ...rest] = argv;
  const command = name === undefined ? undefined : COMMANDS.get(name);
  if (command !== undefined) return command(rest, io);
  io.err(name === undefined ? USAGE : `webtops: unknown command "${name}"\n${USAGE}`);
  return 2;
}

/**
 * The entry point's body: drops the runtime and script names from `processArgv` (what
 * `process.argv` holds), runs the command and returns its exit code, so a test can call it
 * in-process. Only the `import.meta.main` guard below stays out of reach of such a test.
 */
export async function main(processArgv: readonly string[], io: Io): Promise<number> {
  return await run(processArgv.slice(2), io);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv, stdio);
}
