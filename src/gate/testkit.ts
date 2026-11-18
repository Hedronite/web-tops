import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL } from "../config/protocol.ts";
import type { GateRef, Metrics, RawFinding, Report, Verdict } from "../report/types.ts";
import type {
  Consumed,
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
  readonly findings?: readonly RawFinding[];
  readonly metrics?: Metrics;
  readonly classes?: readonly string[];
  readonly requires?: readonly string[];
  /** Defaults to the names in `artifacts`. */
  readonly produces?: readonly string[];
  readonly consumes?: readonly Consumed[];
  readonly artifacts?: Readonly<Record<string, string>>;
  readonly seed?: number;
  /** Appended with the id each time `run` is invoked. */
  readonly calls?: string[];
  readonly onRun?: () => void | Promise<void>;
  readonly throws?: Error;
}

interface FakeDefaults {
  readonly gate: GateRef;
  readonly tier: Tier;
  readonly verdict: Verdict;
  readonly findings: readonly RawFinding[];
  readonly classes: readonly string[];
  readonly requires: readonly string[];
  readonly consumes: readonly Consumed[];
  readonly artifacts: Readonly<Record<string, string>>;
}

const FAKE_DEFAULTS: FakeDefaults = {
  gate: 1,
  tier: 1,
  verdict: "pass",
  findings: [],
  classes: ALL_CLASSES,
  requires: [],
  consumes: [],
  artifacts: {},
};

function reasonField(reason: string | undefined): { reason?: string } {
  return reason === undefined ? {} : { reason };
}

async function play(options: FakeLayerOptions, result: LayerResult): Promise<LayerResult> {
  options.calls?.push(options.id);
  await options.onRun?.();
  if (options.throws !== undefined) {
    throw options.throws;
  }
  return result;
}

export function fakeLayer(options: FakeLayerOptions): Layer {
  const full = { ...FAKE_DEFAULTS, ...options };
  const result: LayerResult = {
    verdict: full.verdict,
    findings: full.findings,
    artifacts: full.artifacts,
    ...reasonField(full.reason),
    ...(full.seed === undefined ? {} : { seed: full.seed }),
    ...(full.metrics === undefined ? {} : { metrics: full.metrics }),
  };
  return {
    id: full.id,
    gate: full.gate,
    tier: full.tier,
    classes: full.classes,
    requires: full.requires,
    produces: full.produces ?? Object.keys(full.artifacts),
    consumes: full.consumes,
    run: () => play(full, result),
  };
}

/** The seven built-in ids as fakes, in section 3.1 order. */
export function fakeBuiltins(
  calls: string[],
  verdicts: Readonly<Record<string, Verdict>> = {},
): Layer[] {
  const table: readonly [string, GateRef, Tier, readonly string[]][] = [
    ["hygiene", 1, 1, []],
    ["tests", 2, 1, []],
    ["coverage", 3, 1, []],
    ["crap", 4, 1, []],
    ["mutation", 5, 1, []],
    ["build-output", 6, 1, []],
    ["laws", "laws", 1, ["hygiene"]],
  ];
  return table.map(([id, gate, tier, requires]) =>
    fakeLayer({
      id,
      gate,
      tier,
      requires,
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
    protocol: PROTOCOL,
    package: "fixture",
    class: "ts-library",
    enforce: "hard",
    reportPath: ".web-tops/report.json",
    toggles: {},
    custom: [],
    optionalLayers: [],
    hygiene: { steps: {}, auditFailOn: "high" },
    tests: { shuffle: true },
    coverage: { linesFloor: 85, exclude: [] },
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

function isCounts(value: unknown): boolean {
  return isRecord(value) && typeof value["ran"] === "number";
}

function isLayerEntry(layer: unknown): boolean {
  return isRecord(layer) && typeof layer["id"] === "string";
}

function hasLayers(value: unknown): boolean {
  return Array.isArray(value) && value.every(isLayerEntry);
}

function hasReportFields(value: Record<string, unknown>): boolean {
  return (
    typeof value["protocol"] === "string" &&
    typeof value["passed"] === "boolean" &&
    (value["exit_code"] === 0 || value["exit_code"] === 1)
  );
}

/** Checks the fields the report always carries; the schema test in G1's validator is the full check. */
function isReport(value: unknown): value is Report {
  return (
    isRecord(value) &&
    hasReportFields(value) &&
    isCounts(value["counts"]) &&
    hasLayers(value["layers"])
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
