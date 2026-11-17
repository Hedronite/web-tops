import { writeFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { LockRead } from "../lock/config.ts";
import { NO_NODE_RANGE, readLockFile } from "../lock/config.ts";
import type { Env } from "../lock/environment.ts";
import { hostVersion } from "../lock/environment.ts";
import { serializeLock } from "../lock/format.ts";
import type { Lock } from "../lock/format.ts";
import { installedVersion } from "../lock/installed.ts";
import { satisfiesNodeRange } from "../lock/node.ts";
import { NODE_RANGE } from "../lock/pins.ts";
import type { Io } from "./io.ts";

const USAGE = "usage: webtops lock [--verify | --update]\n";

type Mode = "verify" | "update";

const MODES = new Map<string, Mode>([
  ["--verify", "verify"],
  ["--update", "update"],
]);

/** No flag, or exactly one of `--verify` and `--update`. */
function parseMode(argv: readonly string[]): Mode | undefined {
  if (argv.length === 0) return "verify";
  return argv.length === 1 ? MODES.get(argv[0] ?? "") : undefined;
}

/** What is installed now for a locked tool: `webtops` is the running kit, every other tool is read from node_modules. */
const installed = (cwd: string, tool: string): string | undefined =>
  tool === "webtops" ? pkg.version : installedVersion(cwd, tool);

/** The locked tools: every entry but `node`, which holds a range, not a version. */
const toolNames = (lock: Lock): string[] => Object.keys(lock).filter((tool) => tool !== "node");

function toolProblems(lock: Lock, cwd: string): string[] {
  return toolNames(lock).flatMap((tool) => {
    const locked = lock[tool] ?? "?";
    const now = installed(cwd, tool);
    if (now === undefined) return [`${tool}: locked ${locked}, not installed`];
    return now === locked ? [] : [`${tool}: locked ${locked}, installed ${now}`];
  });
}

/** The line to print when the Node on the PATH is missing or outside the lock's range, else none. */
function nodeProblems(lock: Lock, env: Env): string[] {
  const range = lock["node"];
  if (range === undefined) return [NO_NODE_RANGE];
  const found = hostVersion("node", env);
  if (found === undefined) return [`node: the lock needs ${range}, and no node is on the PATH`];
  return satisfiesNodeRange(found, range)
    ? []
    : [`node: running ${found}, the lock needs ${range}`];
}

function confirm(lock: Lock, io: Io): number {
  const found = hostVersion("node", io.env) ?? "?";
  const tools = String(toolNames(lock).length);
  io.out(
    `web-tops.lock matches the installed versions of ${tools} tools, and Node ${found} is in its range\n`,
  );
  return 0;
}

function verify(lock: Lock, io: Io): number {
  const problems = [...toolProblems(lock, io.cwd), ...nodeProblems(lock, io.env)];
  if (problems.length === 0) return confirm(lock, io);
  const plural = problems.length === 1 ? "" : "s";
  io.err(
    `webtops lock: ${String(problems.length)} difference${plural} from web-tops.lock (W-41)\n`,
  );
  for (const problem of problems) io.err(`  ${problem}\n`);
  return 2;
}

/** The installed version of each locked tool, and the tools that are not installed. */
function gather(lock: Lock, cwd: string): { next: Record<string, string>; absent: string[] } {
  const next: Record<string, string> = {};
  const absent: string[] = [];
  for (const tool of toolNames(lock)) {
    const now = installed(cwd, tool);
    if (now === undefined) absent.push(tool);
    else next[tool] = now;
  }
  return { next, absent };
}

function writeLock(cwd: string, next: Lock): string | undefined {
  try {
    writeFileSync(join(cwd, "web-tops.lock"), serializeLock(next));
    return undefined;
  } catch (error) {
    return `could not write web-tops.lock: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

function announce(lock: Lock, next: Lock, io: Io): number {
  const changes = Object.entries(next).filter(([tool, version]) => lock[tool] !== version);
  if (changes.length === 0) io.out("web-tops.lock already matches the installed versions\n");
  for (const [tool, version] of changes) io.out(`${tool} ${lock[tool] ?? "?"} -> ${version}\n`);
  return 0;
}

/** Rewrites the lock with the installed versions of the tools it names; the Node range stays as recorded. */
function update(lock: Lock, io: Io): number {
  const { next, absent } = gather(lock, io.cwd);
  if (absent.length > 0) {
    io.err(`webtops lock: cannot update, not installed: ${absent.join(", ")}\n`);
    return 3;
  }
  next["node"] = lock["node"] ?? NODE_RANGE;
  const failure = writeLock(io.cwd, next);
  if (failure !== undefined) {
    io.err(`webtops lock: ${failure}\n`);
    return 3;
  }
  return announce(lock, next, io);
}

/** Why there is no lock to work on. */
const lockProblem = (read: Exclude<LockRead, { state: "ok" }>): string =>
  read.state === "absent" ? "no web-tops.lock here; run `webtops init` to write one" : read.error;

function lockCommand(argv: readonly string[], io: Io): number {
  const mode = parseMode(argv);
  if (mode === undefined) {
    io.err(`webtops lock: bad arguments\n${USAGE}`);
    return 2;
  }
  const read = readLockFile(io.cwd);
  if (read.state !== "ok") {
    io.err(`webtops lock: ${lockProblem(read)}\n`);
    return 2;
  }
  return mode === "update" ? update(read.lock, io) : verify(read.lock, io);
}

/**
 * `webtops lock [--verify | --update]` (WEB_TOPS.md section 10). `--verify` (also the bare form) only reads: it
 * exits 2 on a differing tool version or a Node outside the lock's range. `--update` is the one writer, and
 * writes the installed versions of the tools the lock already names.
 */
export function runLockCli(argv: readonly string[], io: Io): Promise<number> {
  return Promise.resolve(lockCommand(argv, io));
}
