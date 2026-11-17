import type { ClassName } from "./profiles.ts";

export type Tier = 0 | 1 | 2 | 3;
export type Enforce = "hard" | "ratchet" | "advisory";

/** One finding about a config or report: where (a JSON pointer, "" for the document) and what. */
export interface Problem {
  readonly pointer: string;
  readonly message: string;
}

export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** `enabled` (default true) and `reason`; `enabled: false` needs a reason (section 9). */
export interface Switch {
  readonly enabled?: boolean;
  readonly reason?: string;
}

export interface LayerConfig extends Switch {
  readonly tier?: Tier;
}

/** A `layers.custom` item. To switch one off, remove it (section 9). */
export interface CustomLayer {
  readonly id: string;
  readonly tier: Tier;
  readonly command: string;
  /** Where the command writes its report; section 7 asks for one, section 9 does not list it. */
  readonly report?: string;
}

export interface Exclusion {
  readonly glob: string;
  readonly reason: string;
}

/** The dated exemption an `advisory` run needs; `until` is YYYY-MM-DD and must be in the future (section 9). */
export interface Exemption {
  readonly until: string;
  readonly reason: string;
}

export interface Gates {
  /** Gate 1 and its steps (section 9). */
  readonly hygiene?: Switch & {
    readonly install?: Switch;
    readonly tsc?: Switch;
    readonly astro_check?: Switch;
    readonly eslint?: Switch & { readonly config?: string };
    readonly stylelint?: Switch;
    readonly format?: Switch & { readonly tool?: "prettier" | "biome" };
    readonly dependency_cruiser?: Switch;
    readonly audit?: Switch & { readonly fail_on?: "low" | "moderate" | "high" | "critical" };
  };
  readonly tests?: Switch & { readonly runner?: "vitest"; readonly shuffle?: boolean };
  readonly coverage?: Switch & {
    readonly lines_floor?: number;
    readonly exclude?: readonly Exclusion[];
  };
  readonly crap?: Switch & {
    readonly cap?: number;
    readonly scope?: "diff" | "all";
    readonly complexity?: { readonly nullish_discount?: boolean };
  };
  readonly mutation?: Switch & {
    readonly engine?: "stryker";
    readonly scope?: "diff" | "all";
    readonly base?: string;
    readonly unexplained_survivors_max?: number;
    readonly ledger?: string;
  };
}

export interface Layers {
  readonly size_limit?: LayerConfig;
  readonly package_exports?: LayerConfig;
  readonly html_validate?: LayerConfig;
  readonly axe?: LayerConfig;
  readonly rendered?: LayerConfig;
  readonly themes?: LayerConfig;
  readonly custom?: readonly CustomLayer[];
}

/** A `web-tops.yaml` that passed the schema, with the schema's defaults filled in. */
export interface WebTopsConfig {
  readonly protocol: string;
  readonly version: string;
  readonly package: string;
  readonly class: ClassName;
  readonly enforce: Enforce;
  readonly baseline: string;
  readonly exemption?: Exemption;
  readonly toolchain?: { readonly typescript?: string; readonly runtime?: "bun" | "node" };
  readonly gates?: Gates;
  readonly layers?: Layers;
  readonly laws?: Switch & { readonly select?: "default" | "all"; readonly ack_ledger?: string };
  readonly report: { readonly path: string };
}
