import { homedir } from "node:os";
import { chromiumState, hostVersion } from "../lock/environment.ts";
import type { ChromiumState } from "../lock/environment.ts";
import { field, lockedNodeRange, readConfigDoc } from "../lock/config.ts";
import { compareVersions, installedVersion } from "../lock/installed.ts";
import { satisfiesNodeRange } from "../lock/node.ts";
import { TOOL_PINS } from "../lock/pins.ts";
import type { Io } from "./io.ts";

const MIN_BUN = "1.4.0";
const NEEDS_BROWSER = new Set(["ui-components", "astro-site", "web-app"]);
const USAGE = "usage: webtops doctor\n";

/** What the host has: each field is the version found, or undefined when the tool is absent. */
export interface Probe {
  readonly bun: string | undefined;
  readonly node: string | undefined;
  readonly typescript: string | undefined;
  readonly chromium: ChromiumState;
}

/** What the project asks for. `className` is undefined when there is no web-tops.yaml. */
export interface Setup {
  readonly className: string | undefined;
  readonly typescript: string;
  /** The Node range the tools run in: the one `web-tops.lock` records, else the protocol's. */
  readonly nodeRange: string;
}

export interface Check {
  readonly name: string;
  readonly status: "ok" | "missing" | "info";
  readonly detail: string;
}

function bunCheck(probe: Probe): Check {
  const ok = probe.bun !== undefined && compareVersions(probe.bun, MIN_BUN) >= 0;
  const detail = `${probe.bun ?? "not found"} (needs >= ${MIN_BUN})`;
  return { name: "bun", status: ok ? "ok" : "missing", detail };
}

/** Node runs the tools in every class (section 2), so it is checked in all of them. */
function nodeCheck(probe: Probe, setup: Setup): Check {
  const ok = probe.node !== undefined && satisfiesNodeRange(probe.node, setup.nodeRange);
  const detail = `${probe.node ?? "not found"} (needs ${setup.nodeRange})`;
  return { name: "node", status: ok ? "ok" : "missing", detail };
}

function typescriptCheck(probe: Probe, setup: Setup): Check {
  const ok = probe.typescript === setup.typescript;
  return {
    name: "typescript",
    status: ok ? "ok" : "missing",
    detail: ok
      ? `${setup.typescript} (the pin)`
      : `${probe.typescript ?? "not installed"}, the pin is ${setup.typescript}`,
  };
}

/** The Playwright line for a project that needs no browser or names no class, else undefined. */
function browserNotNeeded(setup: Setup): Check | undefined {
  if (setup.className === undefined) {
    return {
      name: "playwright",
      status: "info",
      detail: "not checked: no web-tops.yaml names a class",
    };
  }
  if (NEEDS_BROWSER.has(setup.className)) return undefined;
  return { name: "playwright", status: "info", detail: `not required for ${setup.className}` };
}

const NOT_READY: Record<Exclude<ChromiumState, "present">, string> = {
  "not-installed": "@playwright/test is not installed",
  missing: "its chromium browser is not downloaded (bunx playwright install chromium)",
};

function playwrightCheck(probe: Probe, setup: Setup): Check {
  const skipped = browserNotNeeded(setup);
  if (skipped !== undefined) return skipped;
  if (probe.chromium === "present") {
    return { name: "playwright", status: "ok", detail: "chromium browser present" };
  }
  const detail = `${NOT_READY[probe.chromium]}; ${setup.className ?? "?"} needs it`;
  return { name: "playwright", status: "missing", detail };
}

/** Every requirement the project has, each with its status. Pure: the host is read by the caller. */
export function diagnose(probe: Probe, setup: Setup): readonly Check[] {
  return [
    bunCheck(probe),
    nodeCheck(probe, setup),
    typescriptCheck(probe, setup),
    playwrightCheck(probe, setup),
  ];
}

/** What the project asks for: its class and TypeScript pin from web-tops.yaml, its Node range from web-tops.lock. */
function fromDoc(doc: unknown, nodeRange: string): Setup | string {
  const className = field(doc, "class");
  if (typeof className !== "string" || className === "") return "web-tops.yaml names no class";
  const typescript = field(doc, "toolchain", "typescript");
  return {
    className,
    typescript: typeof typescript === "string" ? typescript : TOOL_PINS.typescript,
    nodeRange,
  };
}

function setupFrom(cwd: string): Setup | string {
  const config = readConfigDoc(cwd);
  const locked = lockedNodeRange(cwd);
  if ("error" in locked) return `web-tops.lock is unusable: ${locked.error}`;
  if (config.state === "invalid") return `web-tops.yaml is not valid YAML: ${config.error}`;
  if (config.state === "absent") {
    return { className: undefined, typescript: TOOL_PINS.typescript, nodeRange: locked.range };
  }
  return fromDoc(config.doc, locked.range);
}

function probeHost(io: Io): Probe {
  return {
    bun: hostVersion("bun", io.env),
    node: hostVersion("node", io.env),
    typescript: installedVersion(io.cwd, "typescript"),
    chromium: chromiumState(io.cwd, io.env, process.platform, homedir()),
  };
}

/** Prints one line per check and returns 3 when any requirement is missing. */
function report(checks: readonly Check[], io: Io): number {
  for (const check of checks)
    io.out(`${check.status.padEnd(8)} ${check.name.padEnd(11)} ${check.detail}\n`);
  const missing = checks.filter((check) => check.status === "missing");
  if (missing.length === 0) {
    io.out("doctor: every requirement is met\n");
    return 0;
  }
  io.err(
    `doctor: ${String(missing.length)} requirement${missing.length === 1 ? "" : "s"} missing\n`,
  );
  return 3;
}

function doctorCommand(argv: readonly string[], io: Io): number {
  if (argv.length > 0) {
    io.err(`webtops doctor: takes no arguments\n${USAGE}`);
    return 2;
  }
  const setup = setupFrom(io.cwd);
  if (typeof setup === "string") {
    io.err(`webtops doctor: ${setup}\n`);
    return 2;
  }
  return report(diagnose(probeHost(io), setup), io);
}

/**
 * `webtops doctor` (WEB_TOPS.md section 12): Bun, Node inside the lock's range, the TypeScript pin and,
 * for classes that need them, the Playwright browser. Exit 3 when a requirement is missing. Installs nothing.
 */
export function runDoctorCli(argv: readonly string[], io: Io): Promise<number> {
  return Promise.resolve(doctorCommand(argv, io));
}
