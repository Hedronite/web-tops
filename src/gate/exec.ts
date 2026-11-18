import { spawn, type ChildProcess } from "node:child_process";
import type { Exec, ExecOptions, ExecResult } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** The environment a process gets: the given one, else this process's, without undefined values. */
function environmentOf(env: ExecOptions["env"]): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env ?? process.env)) {
    if (value !== undefined) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Kills a process, and its children when it leads a group of its own: a run with a time limit does, so a tool that
 * starts workers leaves none behind (the mutation run does).
 */
export function killTree(child: ChildProcess, group: boolean): void {
  const pid = child.pid;
  if (pid === undefined || !group) {
    child.kill("SIGKILL");
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** Runs one process and captures it. A missing binary and a timeout come back as `failure`, never as a throw. */
export const realExec: Exec = (command, args, options = {}) =>
  new Promise<ExecResult>((resolve) => {
    const group = options.timeoutMs !== undefined;
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: environmentOf(options.env),
      stdio: ["ignore", "pipe", "pipe"],
      detached: group,
    });
    let stdout = "";
    let stderr = "";
    let failure: ExecResult["failure"];
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      failure = "tool-timeout";
      killTree(child, group);
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, failure: "tool-missing" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(
        failure === undefined ? { code, stdout, stderr } : { code: null, stdout, stderr, failure },
      );
    });
  });
