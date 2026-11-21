import pkg from "../../package.json" with { type: "json" };
import { candidateTools } from "./candidates.ts";
import { NO_NODE_RANGE } from "./config.ts";
import type { Env } from "./environment.ts";
import { hostVersion } from "./environment.ts";
import type { Lock } from "./format.ts";
import { installedVersion } from "./installed.ts";
import { satisfiesNodeRange } from "./node.ts";

/** What is installed now for a locked tool: `webtops` is the running kit, every other tool is read from node_modules. */
export const installed = (cwd: string, tool: string): string | undefined =>
  tool === "webtops" ? pkg.version : installedVersion(cwd, tool);

/** The locked tools: every entry but `node`, which holds a range, not a version. */
export const toolNames = (lock: Lock): string[] =>
  Object.keys(lock).filter((tool) => tool !== "node");

function toolProblems(lock: Lock, cwd: string): string[] {
  return toolNames(lock).flatMap((tool) => {
    const locked = String(lock[tool]);
    const now = installed(cwd, tool);
    if (now === undefined) return [`${tool}: locked ${locked}, not installed`];
    return now === locked ? [] : [`${tool}: locked ${locked}, installed ${now}`];
  });
}

/** A tool pins.ts pins and package.json declares that is installed and that the lock does not name: a lock that lost an entry, or never had it. */
function missingFromLock(lock: Lock, cwd: string): string[] {
  const found = candidateTools(cwd);
  if (!found.ok) return [found.error];
  return found.names.flatMap((tool) => {
    const now = lock[tool] === undefined ? installedVersion(cwd, tool) : undefined;
    return now === undefined
      ? []
      : [`${tool}: installed ${now}, pinned in section 2, missing from web-tops.lock`];
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

/**
 * What differs between `web-tops.lock` and what is installed (W-41): a locked tool at another version or not installed, a pinned tool the lock does
 * not name, and a Node outside the locked range. None is a difference.
 */
export const lockProblems = (lock: Lock, cwd: string, env: Env): string[] => [
  ...toolProblems(lock, cwd),
  ...missingFromLock(lock, cwd),
  ...nodeProblems(lock, env),
];
