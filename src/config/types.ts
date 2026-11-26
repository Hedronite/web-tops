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

/** `skip_private` skips a package check for a package whose package.json says `"private": true`. */
export interface PackageExportsLayer extends LayerConfig {
  readonly skip_private?: string;
}

export interface SizeLimitLayer extends PackageExportsLayer {
  readonly default_bytes?: number;
  readonly entries?: Readonly<Record<string, number>>;
}

/** Reserved for M4 and M5: validated, not read yet (section 9). */
export interface RenderedLayer extends LayerConfig {
  readonly routes?: readonly string[];
  readonly widths?: readonly number[];
  readonly reduced_motion?: boolean;
}

export interface ThemesLayer extends LayerConfig {
  readonly switch?: { readonly mechanism: "attribute" | "class" | "media"; readonly name: string };
  readonly schemes?: readonly string[];
  readonly tokens?: readonly string[];
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
    readonly time_budget_minutes?: number;
    readonly ledger?: string;
  };
}

export interface BuildConfig {
  readonly command?: string;
  readonly dir?: string;
}

export interface BudgetsConfig {
  readonly page_js_bytes?: number;
  readonly static_page_js_bytes?: number;
  readonly route_js_bytes?: number;
  readonly pages?: Readonly<Record<string, number>>;
  readonly routes?: Readonly<Record<string, number>>;
  readonly entries?: Readonly<Record<string, number>>;
}

export interface Layers {
  readonly size_limit?: SizeLimitLayer;
  readonly package_exports?: PackageExportsLayer;
  readonly html_validate?: LayerConfig;
  readonly axe?: LayerConfig;
  readonly rendered?: RenderedLayer;
  readonly themes?: ThemesLayer;
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
  readonly build?: BuildConfig;
  readonly routes?: readonly string[];
  readonly budgets?: BudgetsConfig;
  readonly layers?: Layers;
  readonly laws?: Switch & { readonly select?: "default" | "all"; readonly ack_ledger?: string };
  readonly report: { readonly path: string };
}
