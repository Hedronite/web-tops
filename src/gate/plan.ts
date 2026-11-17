import type { GateRef } from "../report/types.ts";
import { compareGates } from "./order.ts";
import type { GateConfig, GateOptions, Layer, Tier } from "./types.ts";

export interface PlanItem {
  readonly id: string;
  readonly gate: GateRef;
  readonly tier: Tier;
  /** Whether the class profile requires the layer (section 3.3). */
  readonly required: boolean;
  /** Absent for an id the config enables but nothing registers. */
  readonly layer?: Layer;
  /** Present when the layer will not run, with the reason the report prints. */
  readonly skip?: string;
  /** The `--only` layer that pulled this one in through `requires`. */
  readonly requiredBy?: string;
}

/** The layers `--only` selects, each with the layer that pulled it in (none for the one named). */
type Selection = ReadonlyMap<string, string | undefined>;

/** What the skip checks look at: a layer, or an id the config enables that nothing registers. */
interface Subject {
  readonly id: string;
  readonly tier: Tier;
  readonly classes?: readonly string[];
}

interface Scope {
  readonly config: GateConfig;
  readonly options: GateOptions;
  readonly selected: Selection;
}

function requiresOf(layers: readonly Layer[], id: string): readonly string[] {
  return layers.find((layer) => layer.id === id)?.requires ?? [];
}

function select(
  layers: readonly Layer[],
  selected: Map<string, string | undefined>,
  id: string,
  requester: string | undefined,
): void {
  if (selected.has(id)) {
    return;
  }
  selected.set(id, requester);
  for (const required of requiresOf(layers, id)) {
    select(layers, selected, required, requester ?? id);
  }
}

/** The layers `--only` selects: the named one and, transitively, what it requires. */
function selectedBy(only: string | undefined, layers: readonly Layer[]): Selection {
  const selected = new Map<string, string | undefined>();
  if (only !== undefined) {
    select(layers, selected, only, undefined);
  }
  return selected;
}

type SkipCheck = (subject: Subject, scope: Scope) => string | undefined;

const disabled: SkipCheck = (subject, scope) => {
  const toggle = scope.config.toggles[subject.id];
  return toggle?.enabled === false ? (toggle.reason ?? "disabled in web-tops.yaml") : undefined;
};

const unmapped: SkipCheck = (subject, scope) =>
  subject.classes !== undefined && !subject.classes.includes(scope.config.class)
    ? `class ${scope.config.class} does not map this layer`
    : undefined;

const aboveTier: SkipCheck = (subject, scope) =>
  subject.tier > scope.options.maxTier
    ? `tier ${String(subject.tier)} is above --max-tier ${String(scope.options.maxTier)}`
    : undefined;

const notSelected: SkipCheck = (subject, scope) =>
  scope.options.only !== undefined && !scope.selected.has(subject.id)
    ? `not selected by --only ${scope.options.only}`
    : undefined;

/** In the order the report words them: the config's switch, the class, the tier, then `--only`. */
const SKIP_CHECKS: readonly SkipCheck[] = [disabled, unmapped, aboveTier, notSelected];

function skipReason(subject: Subject, scope: Scope): string | undefined {
  for (const check of SKIP_CHECKS) {
    const reason = check(subject, scope);
    if (reason !== undefined) {
      return reason;
    }
  }
  return undefined;
}

function isRequired(config: GateConfig, id: string): boolean {
  return !config.optionalLayers.includes(id);
}

function itemFor(layer: Layer, scope: Scope): PlanItem {
  const skip = skipReason(layer, scope);
  const requiredBy = scope.selected.get(layer.id);
  return {
    id: layer.id,
    gate: layer.gate,
    tier: layer.tier,
    required: isRequired(scope.config, layer.id),
    layer,
    ...(skip === undefined ? {} : { skip }),
    ...(requiredBy === undefined ? {} : { requiredBy }),
  };
}

/** Ids the config enables and nothing registers: each is `not-run` (an unmapped custom layer), never silently absent. */
function unregistered(layers: readonly Layer[], scope: Scope): PlanItem[] {
  if (scope.options.only !== undefined) {
    return [];
  }
  const known = new Set(layers.map((layer) => layer.id));
  return Object.entries(scope.config.toggles)
    .filter(([id, toggle]) => toggle.enabled && !known.has(id))
    .map(([id]) => {
      const skip = skipReason({ id, tier: 1 }, scope);
      return {
        id,
        gate: 6,
        tier: 1,
        required: isRequired(scope.config, id),
        ...(skip === undefined ? {} : { skip }),
      };
    });
}

/** What a run would do, layer by layer, in gate order. `--dry-run` prints it; `runGate` follows it. */
export function planGate(
  layers: readonly Layer[],
  config: GateConfig,
  options: GateOptions,
): PlanItem[] {
  const scope: Scope = { config, options, selected: selectedBy(options.only, layers) };
  const ordered = [...layers].sort((a, b) => compareGates(a.gate, b.gate));
  return [...ordered.map((layer) => itemFor(layer, scope)), ...unregistered(layers, scope)];
}
