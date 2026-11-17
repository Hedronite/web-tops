import { LAUNCH_CLASSES } from "../init/profile.ts";
import type { InitOutcome } from "../init/run.ts";
import { runInit } from "../init/run.ts";
import type { Io } from "./io.ts";

const USAGE = "usage: webtops init --class <class> [--force]\n";

interface Args {
  readonly className: string | undefined;
  readonly force: boolean;
}

/** What one option sets, and how many arguments it used. */
interface Option extends Args {
  readonly used: number;
}

/** `--class` takes the next argument, which must not be another option. */
function classValue(next: string | undefined): Option | string {
  if (next === undefined || next.startsWith("--")) return "--class needs a value";
  return { className: next, force: false, used: 2 };
}

function readOption(arg: string, next: string | undefined): Option | string {
  if (arg === "--force") return { className: undefined, force: true, used: 1 };
  if (arg.startsWith("--class=")) {
    return { className: arg.slice("--class=".length), force: false, used: 1 };
  }
  return arg === "--class" ? classValue(next) : `unknown option "${arg}"`;
}

const merge = (args: Args, option: Option): Args => ({
  className: option.className ?? args.className,
  force: option.force || args.force,
});

function parseArgs(argv: readonly string[]): Args | string {
  let args: Args = { className: undefined, force: false };
  let i = 0;
  while (i < argv.length) {
    const option = readOption(argv[i] ?? "", argv[i + 1]);
    if (typeof option === "string") return option;
    args = merge(args, option);
    i += option.used;
  }
  return args;
}

/** Prints what the run wrote, or why it did not, and returns its exit code. */
function report(outcome: InitOutcome, io: Io): number {
  if (outcome.code !== 0) {
    for (const problem of outcome.problems) io.err(`webtops init: ${problem}\n`);
    return outcome.code;
  }
  io.out(outcome.written.map((path) => `wrote ${path}\n`).join(""));
  io.out(`install the pinned tools:\n  bun add -d ${outcome.install.join(" ")}\n`);
  return 0;
}

function initCommand(argv: readonly string[], io: Io): number {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    io.err(`webtops init: ${args}\n${USAGE}`);
    return 2;
  }
  if (args.className === undefined) {
    io.err(`${USAGE}classes: ${LAUNCH_CLASSES.join(", ")}\n`);
    return 2;
  }
  return report(runInit({ className: args.className, dir: io.cwd, force: args.force }), io);
}

/** `webtops init --class <c> [--force]` (WEB_TOPS.md section 4): writes the drop-in set into the working directory. */
export function runInitCli(argv: readonly string[], io: Io): Promise<number> {
  return Promise.resolve(initCommand(argv, io));
}
