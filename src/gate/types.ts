import type { ClassName } from "../config/profiles.ts";
import type { PROTOCOL } from "../config/protocol.ts";
import type { Enforce, Finding, GateRef, Verdict } from "../report/types.ts";

export type Tier = 0 | 1 | 2 | 3;

/** The seven built-in layers (WEB_TOPS.md section 3.1). Custom layers add their own ids. */
export const BUILTIN_IDS = [
  "hygiene",
  "tests",
  "coverage",
  "crap",
  "mutation",
  "build-output",
  "laws",
] as const;

export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
}

export interface ExecResult {
  /** Exit code, or null when the process never ran to an exit. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the process could not run (`tool-missing`) or was killed (`tool-timeout`). */
  readonly failure?: "tool-missing" | "tool-timeout";
}

export type Exec = (
  command: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

export interface LayerResult {
  /** The layer's own verdict, already aggregated from its findings. */
  readonly verdict: Verdict;
  /** Required with `skip` and `not-evaluated`. */
  readonly reason?: string;
  readonly findings: readonly Finding[];
  /** Files this layer wrote this run, by name (for example `lcov`); later layers read them. */
  readonly artifacts: Readonly<Record<string, string>>;
}

export interface LayerContext {
  readonly cwd: string;
  readonly config: GateConfig;
  /** `--base`, else `gates.mutation.base`, else `origin/main`. */
  readonly base: string;
  readonly enforce: Enforce;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exec: Exec;
  /** `.web-tops/out`, emptied when the run starts so no layer reads a stale file. */
  readonly outDir: string;
  /** The inputs this layer declared in `consumes`, by artifact name, each from the layer it named. */
  readonly artifacts: ReadonlyMap<string, string>;
}

/** An input a layer reads: the artifact's name and the layer that produces it (R29 N5, WEB_TOPS.md section 3.1). */
export interface Consumed {
  readonly artifact: string;
  readonly from: string;
}

export interface Layer {
  readonly id: string;
  readonly gate: GateRef;
  readonly tier: Tier;
  /** Classes that map this layer; any other class gets `skip`. */
  readonly classes: readonly string[];
  /** Layers whose artifacts this one reads; `--only` runs them too. */
  readonly requires: readonly string[];
  /** Artifacts this layer writes, by name, under `.web-tops/out/<id>/`; it lists the ones it wrote in its result. */
  readonly produces: readonly string[];
  /** Artifacts this layer reads; one that is missing makes the layer `not-run` before it starts. */
  readonly consumes: readonly Consumed[];
  readonly run: (context: LayerContext) => Promise<LayerResult>;
}

export interface Toggle {
  readonly enabled: boolean;
  /** Required by the schema when `enabled` is false. */
  readonly reason?: string;
}

export interface CustomLayer {
  readonly id: string;
  readonly tier: Tier;
  readonly command?: string;
}

/** What the runner needs from a validated `web-tops.yaml`; a layer's own settings join it in G3 and G4. */
export interface GateConfig {
  readonly protocol: typeof PROTOCOL;
  readonly package: string;
  readonly class: ClassName;
  readonly enforce: Enforce;
  /** `gates.mutation.base`. */
  readonly base?: string;
  /** `report.path`. */
  readonly reportPath: string;
  /** Enable switches by layer id; an id with no entry is enabled (section 9). */
  readonly toggles: Readonly<Record<string, Toggle>>;
  readonly custom: readonly CustomLayer[];
}

export interface GateOptions {
  readonly maxTier: Tier;
  /** `--only`: one layer id. */
  readonly only?: string;
  readonly base?: string;
  readonly keepGoing: boolean;
  readonly json: boolean;
  readonly dryRun: boolean;
}

export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}
