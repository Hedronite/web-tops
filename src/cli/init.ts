import { LAUNCH_CLASSES } from "../init/profile";
import { runInit } from "../init/run";
import type { Io } from "./main";

const USAGE = "usage: webtops init --class <class> [--force]\n";

interface Args {
  readonly className: string | undefined;
  readonly force: boolean;
}

function parseArgs(argv: readonly string[]): Args | string {
  let className: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--force") {
      force = true;
    } else if (arg.startsWith("--class=")) {
      className = arg.slice("--class=".length);
    } else if (arg === "--class") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return "--class needs a value";
      className = next;
      i += 1;
    } else {
      return `unknown option "${arg}"`;
    }
  }
  return { className, force };
}

function initCommand(argv: readonly string[], io: Io, cwd: string): number {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    io.err(`webtops init: ${args}\n${USAGE}`);
    return 2;
  }
  if (args.className === undefined) {
    io.err(`${USAGE}classes: ${LAUNCH_CLASSES.join(", ")}\n`);
    return 2;
  }
  const outcome = runInit({ className: args.className, dir: cwd, force: args.force });
  if (outcome.code !== 0) {
    for (const problem of outcome.problems) io.err(`webtops init: ${problem}\n`);
    return outcome.code;
  }
  io.out(outcome.written.map((path) => `wrote ${path}\n`).join(""));
  io.out(`deferred to M2: ${outcome.deferred.join(", ")} (mutation testing)\n`);
  io.out(`install the pinned tools:\n  bun add -d ${outcome.install.join(" ")}\n`);
  return 0;
}

/** `webtops init --class <c> [--force]` (WEB_TOPS.md section 4): writes the drop-in set into the working directory. */
export function runInitCli(argv: readonly string[], io: Io, cwd: string = process.cwd()): Promise<number> {
  return Promise.resolve(initCommand(argv, io, cwd));
}
