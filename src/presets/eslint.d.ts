import type { Linter } from "eslint";

/** The plugin set a class adds on top of the base law rules. */
export type EslintVariant = "base" | "react" | "astro";

export interface EslintPresetOptions {
  readonly variant: EslintVariant;
  /** The project root, so the type-aware rules find its tsconfig. */
  readonly tsconfigRootDir: string;
  /** The project's class, which decides the rules of `eslint-plugin-webtops`; read from `web-tops.yaml` when left out. */
  readonly class?: string;
}

export const VARIANTS: readonly EslintVariant[];

/** Every package a variant imports. */
export const PACKAGES: Readonly<Record<EslintVariant, readonly string[]>>;

export function eslintPreset(options: EslintPresetOptions): Promise<Linter.Config[]>;
