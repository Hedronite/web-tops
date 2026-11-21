import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LockRead } from "../lock/config.ts";
import { readLockFile } from "../lock/config.ts";
import { candidateTools } from "../lock/candidates.ts";
import { hostVersion } from "../lock/environment.ts";
import { serializeLock } from "../lock/format.ts";
import type { Lock } from "../lock/format.ts";
import { NODE_RANGE } from "../lock/pins.ts";
import { installed, lockProblems, toolNames } from "../lock/verify.ts";
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

function confirm(lock: Lock, io: Io): number {
  const found = hostVersion("node", io.env) ?? "?";
  const tools = String(toolNames(lock).length);
  io.out(
    `web-tops.lock matches the installed versions of ${tools} tools, and Node ${found} is in its range\n`,
  );
  return 0;
}

function verify(lock: Lock, io: Io): number {
  const problems = lockProblems(lock, io.cwd, io.env);
  if (problems.length === 0) return confirm(lock, io);
  const plural = problems.length === 1 ? "" : "s";
  io.err(
    `webtops lock: ${String(problems.length)} difference${plural} from web-tops.lock (W-41)\n`,
  );
  for (const problem of problems) io.err(`  ${problem}\n`);
  return 2;
}

type Gathered = { readonly next: Record<string, string> } | { readonly error: string };

/** What `--update` looks at: the running kit, the tools the lock names, and the candidates. */
const namesToRead = (lock: Lock, candidates: readonly string[]): string[] => [
  ...new Set(["webtops", ...toolNames(lock), ...candidates]),
];

/**
 * The installed version of each name. A name that is not installed is skipped when only a candidate,
 * and listed as absent when the lock names it (the lock never silently loses an entry).
 */
function scan(lock: Lock, cwd: string, names: readonly string[]) {
  const next: Record<string, string> = {};
  const absent: string[] = [];
  for (const tool of names) {
    const now = installed(cwd, tool);
    if (now !== undefined) next[tool] = now;
    else if (lock[tool] !== undefined) absent.push(tool);
  }
  return { next, absent };
}

function gather(lock: Lock, cwd: string): Gathered {
  const found = candidateTools(cwd);
  if (!found.ok) return { error: `cannot update, ${found.error}` };
  const { next, absent } = scan(lock, cwd, namesToRead(lock, found.names));
  return absent.length > 0
    ? { error: `cannot update, not installed: ${absent.join(", ")}` }
    : { next };
}

function writeLock(cwd: string, next: Lock): string | undefined {
  try {
    writeFileSync(join(cwd, "web-tops.lock"), serializeLock(next));
    return undefined;
  } catch (error) {
    return `could not write web-tops.lock: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

/** What the lock held for a tool before the update: its version, or `(new)` for an entry it did not have. */
const before = (lock: Lock, tool: string): string => lock[tool] ?? "(new)";

function announce(lock: Lock, next: Lock, io: Io): number {
  const changes = Object.entries(next).filter(([tool, version]) => lock[tool] !== version);
  if (changes.length === 0) io.out("web-tops.lock already matches the installed versions\n");
  for (const [tool, version] of changes) io.out(`${tool} ${before(lock, tool)} -> ${version}\n`);
  return 0;
}

/**
 * Rewrites the lock with the installed versions of the tools it names, and adds every installed tool
 * that pins.ts pins and package.json declares (WEB_TOPS.md section 2); the Node range stays as recorded.
 */
function update(lock: Lock, io: Io): number {
  const gathered = gather(lock, io.cwd);
  if ("error" in gathered) {
    io.err(`webtops lock: ${gathered.error}\n`);
    return 3;
  }
  const next = gathered.next;
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
 * writes the installed versions of the tools the lock names, and adds the installed tools that pins.ts pins and package.json declares.
 */
export function runLockCli(argv: readonly string[], io: Io): Promise<number> {
  return Promise.resolve(lockCommand(argv, io));
}
