import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding, GateRef, Report, Verdict } from "../report/types.ts";
import type {
  Exec,
  GateConfig,
  GateOptions,
  Io,
  Layer,
  LayerResult,
  Tier,
  Toggle,
} from "./types.ts";

/** Test support for the runner's oracle tests: fake layers, configs, streams and temp projects. */

export const ALL_CLASSES = ["ts-library", "ui-components", "astro-site", "web-app", "node-service"];

export interface FakeLayerOptions {
  readonly id: string;
  readonly gate?: GateRef;
  readonly tier?: Tier;
  readonly verdict?: Verdict;
  readonly reason?: string;
  readonly findings?: readonly Finding[];
  readonly classes?: readonly string[];
  readonly requires?: readonly string[];
  readonly artifacts?: Readonly<Record<string, string>>;
  /** Appended with the id each time `run` is invoked. */
  readonly calls?: string[];
  readonly onRun?: () => void | Promise<void>;
  readonly throws?: Error;
}

export function fakeLayer(options: FakeLayerOptions): Layer {
  const result: LayerResult = {
    verdict: options.verdict ?? "pass",
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    findings: options.findings ?? [],
    artifacts: options.artifacts ?? {},
  };
  return {
    id: options.id,
    gate: options.gate ?? 1,
    tier: options.tier ?? 1,
    classes: options.classes ?? ALL_CLASSES,
    requires: options.requires ?? [],
    run: async () => {
      options.calls?.push(options.id);
      await options.onRun?.();
      if (options.throws !== undefined) {
        throw options.throws;
      }
      return result;
    },
  };
}

/** The seven built-in ids as fakes, in section 3.1 order. */
export function fakeBuiltins(
  calls: string[],
  verdicts: Readonly<Record<string, Verdict>> = {},
): Layer[] {
  const table: readonly [string, GateRef, Tier][] = [
    ["hygiene", 1, 1],
    ["tests", 2, 1],
    ["coverage", 3, 1],
    ["crap", 4, 1],
    ["mutation", 5, 1],
    ["build-output", 6, 1],
    ["laws", "laws", 0],
  ];
  return table.map(([id, gate, tier]) =>
    fakeLayer({
      id,
      gate,
      tier,
      calls,
      verdict: verdicts[id] ?? "pass",
      ...(verdicts[id] === undefined || verdicts[id] === "pass"
        ? {}
        : { reason: `fake ${verdicts[id]}` }),
    }),
  );
}

export function cfg(overrides: Partial<GateConfig> = {}): GateConfig {
  return {
    protocol: "0.2.1",
    package: "fixture",
    class: "ts-library",
    enforce: "hard",
    reportPath: ".web-tops/report.json",
    toggles: {},
    custom: [],
    ...overrides,
  };
}

export function off(reason: string): Toggle {
  return { enabled: false, reason };
}

export function opts(overrides: Partial<GateOptions> = {}): GateOptions {
  return { maxTier: 1, keepGoing: false, json: false, dryRun: false, ...overrides };
}

export interface MemoryIo extends Io {
  readonly stdout: () => string;
  readonly stderr: () => string;
}

export function memoryIo(): MemoryIo {
  let out = "";
  let err = "";
  return {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    stdout: () => out,
    stderr: () => err,
  };
}

/** An `exec` that fails the test if a layer reaches for a process it should not start. */
export const noExec: Exec = () => Promise.reject(new Error("exec is not expected in this test"));

/** A fixed clock that advances by one millisecond per read. */
export function tickingClock(): () => number {
  let now = 1000;
  return () => now++;
}

export interface TempProject {
  readonly dir: string;
  readonly cleanup: () => void;
}

/** A fresh directory from `mkdtemp`; cleanup removes only what this call made. */
export function tempProject(): TempProject {
  const dir = mkdtempSync(join(tmpdir(), "wt-gate-"));
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Checks the fields the report always carries; the schema test in G1's validator is the full check. */
function isReport(value: unknown): value is Report {
  return (
    isRecord(value) &&
    typeof value["protocol"] === "string" &&
    typeof value["passed"] === "boolean" &&
    (value["exit_code"] === 0 || value["exit_code"] === 1) &&
    isRecord(value["counts"]) &&
    typeof value["counts"]["ran"] === "number" &&
    Array.isArray(value["layers"]) &&
    value["layers"].every((layer: unknown) => isRecord(layer) && typeof layer["id"] === "string")
  );
}

/** Parses report JSON without an assertion. */
export function parseReport(text: string): Report {
  const value: unknown = JSON.parse(text);
  if (isReport(value)) {
    return value;
  }
  throw new Error(`not a report: ${text.slice(0, 80)}`);
}
