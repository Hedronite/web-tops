import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Exec, ExecResult, RunDescription } from "./types.ts";

/** What the run block of the report is made of (WEB_TOPS.md section 6.6): the SHA, the runtimes, the tool versions. */

const NODE_MODULES = "node_modules";
const SHA = /^[0-9a-f]{40}$/u;

/** `eslint`, or `@scope/name` when the first segment is a scope. */
function nameAt(first: string, second: string | undefined): string {
  return first.startsWith("@") && second !== undefined ? `${first}/${second}` : first;
}

/** The package a path inside `node_modules` belongs to; the innermost one for a nested install. */
function packageOf(path: string): string | undefined {
  const parts = path.split(/[\\/]/u);
  const index = parts.lastIndexOf(NODE_MODULES);
  const first = parts[index + 1];
  return index < 0 || first === undefined || first === ""
    ? undefined
    : nameAt(first, parts[index + 2]);
}

export interface ToolRecorder {
  /** The exec to give the layers: it passes every call through and notes the tool a `node` call runs. */
  readonly exec: Exec;
  /** The packages whose executables ran, sorted and without repeats. */
  readonly used: () => readonly string[];
}

/** Tools run as `node <entry in node_modules/<package>/...>` (WEB_TOPS.md section 3.1), so the entry names the tool. */
export function recordTools(exec: Exec): ToolRecorder {
  const packages = new Set<string>();
  return {
    exec: (command, args, options) => {
      const entry = command === "node" ? args[0] : undefined;
      const name = entry === undefined ? undefined : packageOf(entry);
      if (name !== undefined) {
        packages.add(name);
      }
      return exec(command, args, options);
    },
    used: () => [...packages].sort(),
  };
}

/** The trimmed output of a command that exited 0, or undefined when it failed or could not run. */
async function answer(
  exec: Exec,
  cwd: string,
  command: string,
  args: readonly string[],
): Promise<string | undefined> {
  const result: ExecResult | undefined = await exec(command, args, { cwd }).catch(() => undefined);
  const text = result?.code === 0 ? result.stdout.trim() : "";
  return text === "" ? undefined : text;
}

function readManifest(path: string): unknown {
  try {
    const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
    return manifest;
  } catch {
    return undefined;
  }
}

function versionField(manifest: unknown): unknown {
  return typeof manifest === "object" && manifest !== null
    ? Reflect.get(manifest, "version")
    : undefined;
}

function versionOf(cwd: string, name: string): string | undefined {
  const version = versionField(readManifest(join(cwd, NODE_MODULES, name, "package.json")));
  return typeof version === "string" && version !== "" ? version : undefined;
}

function toolVersions(cwd: string, used: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    used.flatMap((name): [string, string][] => {
      const version = versionOf(cwd, name);
      return version === undefined ? [] : [[name, version]];
    }),
  );
}

export interface DescribeInput {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The real exec, not the recording one: asking for a version is not running a tool. */
  readonly exec: Exec;
  readonly used: readonly string[];
}

const asSha = (text: string | undefined): string | null =>
  text !== undefined && SHA.test(text) ? text : null;

/** The prefix git prints is `packages/fixture/`, or nothing at the top level. */
function asRoot(prefix: string | undefined): string {
  const trimmed = (prefix ?? "").replace(/\/+$/u, "");
  return trimmed === "" ? "." : trimmed;
}

const asNode = (text: string | undefined): string | null =>
  text === undefined ? null : text.replace(/^v/u, "");

/** The SHA, the root, `bun` and `node`, and the version of each tool that ran, read from `node_modules`. */
export async function describeRun(input: DescribeInput): Promise<RunDescription> {
  const { cwd, exec } = input;
  const [sha, prefix, bun, node] = await Promise.all([
    answer(exec, cwd, "git", ["rev-parse", "HEAD"]),
    answer(exec, cwd, "git", ["rev-parse", "--show-prefix"]),
    answer(exec, cwd, "bun", ["--version"]),
    answer(exec, cwd, "node", ["--version"]),
  ]);
  return {
    root: asRoot(prefix),
    sha: asSha(sha),
    bun: bun ?? null,
    node: asNode(node),
    tools: toolVersions(cwd, input.used),
  };
}
