import type { ScopeResult } from "../diff/types.ts";
import type { ClassName } from "../config/profiles.ts";
import type { Enforce, GateRef, Metrics, RawFinding, Verdict } from "../report/types.ts";

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
  readonly findings: readonly RawFinding[];
  /** Files this layer wrote this run, by name (for example `lcov`); later layers read them. */
  readonly artifacts: Readonly<Record<string, string>>;
  /** The shuffle seed the tests layer passed, so a shuffled failure can be rerun (WEB_TOPS.md section 6.6). */
  readonly seed?: number;
  /** Shaped for `webtops baseline` (section 6.6); omitted when the layer has none. */
  readonly metrics?: Metrics;
}

/** What the runner records about the run beside the layers: the root, the SHA, the runtimes and the tool versions. */
export interface RunDescription {
  readonly root: string;
  readonly sha: string | null;
  readonly bun: string | null;
  readonly node: string | null;
  readonly tools: Readonly<Record<string, string>>;
}

/** What a layer needs from the diff: the functions a changed test file runs cost a Vitest run, so a layer says when it needs them. */
export interface DiffNeeds {
  readonly coveredByTests: boolean;
}

/** The diff of this run against the merge base (WEB_TOPS.md section 6.4), computed the first time a layer asks. */
export type DiffProvider = (needs: DiffNeeds) => Promise<ScopeResult>;

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
  /** `--all`: judge everything, not the diff's scope. */
  readonly all?: boolean;
  /** The diff of this run, for a layer judged on what changed; without one a diff-scoped layer judges everything. */
  readonly diff?: DiffProvider;
  /** The UTC day of the run, `YYYY-MM-DD`, from the runner's clock: what an expiry is compared with, the same in every layer. */
  readonly today?: string;
  /** The `survivorKey` strings the survivor ledger explains; empty until the ledger is read (G8). */
  readonly explained?: ReadonlySet<string>;
}

/** An input a layer reads: the artifact's name and the layer that produces it (R29 N5, WEB_TOPS.md section 3.1). */
export interface Consumed {
  readonly artifact: string;
  readonly from: string;
  /**
   * The runner passes the artifact if the producer left it and skips it if not, where a missing input otherwise makes
   * the layer `not-run`. The layer says what a missing one means for what it judges (R92): a required law whose
   * artifact is missing is `not-evaluated`, which ends the run.
   */
  readonly optional?: boolean;
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

/** Gate 1 steps (WEB_TOPS.md section 9); `package_exports` runs publint and attw inside the gate. */
export const HYGIENE_STEPS = [
  "install",
  "tsc",
  "astro_check",
  "eslint",
  "stylelint",
  "format",
  "dependency_cruiser",
  "audit",
  "package_exports",
] as const;

export type HygieneStep = (typeof HYGIENE_STEPS)[number];

export type AuditLevel = "low" | "moderate" | "high" | "critical";

/** Gate 1 settings from `gates.hygiene` and `layers.package_exports`, resolved against the class profile. */
export interface HygieneSettings {
  /** Step switches by key; a step with no entry is enabled. */
  readonly steps: Readonly<Partial<Record<HygieneStep, Toggle>>>;
  /** `gates.hygiene.eslint.config`. */
  readonly eslintConfig?: string;
  /** `gates.hygiene.format.tool`; unset means read the one formatter config in the repo. */
  readonly formatTool?: "prettier" | "biome";
  /** `gates.hygiene.audit.fail_on`. */
  readonly auditFailOn: AuditLevel;
}

export interface CoverageExclusion {
  readonly glob: string;
  readonly reason: string;
}

/** Gate 2 settings from `gates.tests`. */
export interface TestsSettings {
  /** `gates.tests.shuffle`. */
  readonly shuffle: boolean;
}

/** Gate 3 settings from `gates.coverage`, with the class floor filled in by the adapter. */
export interface CoverageSettings {
  /** `gates.coverage.lines_floor`, else the class profile's floor (WEB_TOPS.md section 5.2). */
  readonly linesFloor: number;
  /** `gates.coverage.exclude`: reasoned exclusions beyond the defaults of section 6.1. */
  readonly exclude: readonly CoverageExclusion[];
}

/** Gate 4 settings from `gates.crap`, with the class cap filled in by the adapter (WEB_TOPS.md sections 5.2 and 6.2). */
export interface CrapSettings {
  /** `gates.crap.cap`, else the class profile's CRAP cap. */
  readonly cap: number;
  /** `gates.crap.scope`: the functions the diff touches, or all of them. */
  readonly scope: "diff" | "all";
  /** `gates.crap.complexity.nullish_discount`: `??`, `??=` and `?.` weigh 0 (default true). */
  readonly nullishDiscount: boolean;
}

/** Gate 5 settings from `gates.mutation`, with the class's values filled in by the adapter (WEB_TOPS.md sections 5.2 and 6.4). */
export interface MutationSettings {
  /** `gates.mutation.scope`: the diff's functions, or every source file. */
  readonly scope: "diff" | "all";
  /** `gates.mutation.unexplained_survivors_max`, else the class profile's. */
  readonly maxSurvivors: number;
  /** `gates.mutation.time_budget_minutes`, else the profile's: a run that passes it is `not-evaluated`. */
  readonly timeBudgetMinutes: number;
  /** `gates.mutation.ledger`: the survivor ledger; `.web-tops/survivors.yaml` when the config names none. */
  readonly ledger?: string;
}

/** What the runner needs from a validated `web-tops.yaml`; a layer's own settings join it in G3 and G4. */
export interface GateConfig {
  readonly protocol: string;
  readonly package: string;
  readonly class: ClassName;
  readonly enforce: Enforce;
  /** `gates.mutation.base`. */
  readonly base?: string;
  /** `report.path`. */
  readonly reportPath: string;
  /** `laws.ack_ledger`: the ledger of acknowledgements (WEB_TOPS.md section 8.1); absent, the default path. */
  readonly ackLedger?: string;
  /** `baseline`: the file `ratchet` holds the run to (WEB_TOPS.md section 6.7). */
  readonly baselinePath?: string;
  /** Enable switches by layer id; an id with no entry is enabled (section 9). */
  readonly toggles: Readonly<Record<string, Toggle>>;
  readonly custom: readonly CustomLayer[];
  /** Built-in layers the class profile does not require (section 3.3); every other layer is required. */
  readonly optionalLayers: readonly string[];
  readonly hygiene: HygieneSettings;
  readonly tests: TestsSettings;
  readonly coverage: CoverageSettings;
  readonly crap: CrapSettings;
  readonly mutation: MutationSettings;
}

export interface GateOptions {
  readonly maxTier: Tier;
  /** `--only`: one layer id. */
  readonly only?: string;
  readonly base?: string;
  readonly keepGoing: boolean;
  readonly json: boolean;
  readonly dryRun: boolean;
  /** `--all`: judge every function, not only the diff's. */
  readonly all: boolean;
}

export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}
