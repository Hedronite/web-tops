#!/usr/bin/env bun
import pkg from "../../package.json" with { type: "json" };

export const PROTOCOL = "0.2.0";

const USAGE = "usage: webtops <command>\ncommands: version\n";

export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** Runs one `webtops` invocation and returns its exit code (WEB_TOPS.md section 12). */
export function run(argv: readonly string[], io: Io): number {
  const [command] = argv;
  if (command === "version") {
    io.out(`protocol ${PROTOCOL}\npackage ${pkg.version}\n`);
    return 0;
  }
  io.err(command === undefined ? USAGE : `webtops: unknown command "${command}"\n${USAGE}`);
  return 2;
}

/** The process streams, for the entry point below. */
export const stdio: Io = {
  out: (text) => {
    process.stdout.write(text);
  },
  err: (text) => {
    process.stderr.write(text);
  },
};

if (import.meta.main) {
  process.exitCode = run(process.argv.slice(2), stdio);
}
