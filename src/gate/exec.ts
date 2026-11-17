import { spawn } from "node:child_process";
import type { Exec, ExecResult } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Runs one process and captures it. A missing binary and a timeout come back as `failure`, never as a throw. */
export const realExec: Exec = (command, args, options = {}) =>
  new Promise<ExecResult>((resolve) => {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(options.env ?? process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
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
      child.kill("SIGKILL");
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
