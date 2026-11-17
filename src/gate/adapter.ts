import { profileFor } from "../config/profiles.ts";
import type { LayerKey } from "../config/profiles.ts";
import type { Switch, WebTopsConfig } from "../config/types.ts";
import type { GateConfig, Toggle } from "./types.ts";

/** A switch the config turned off, with its reason; an absent or enabled switch needs no entry. */
function off(entry: Switch | undefined): Toggle | undefined {
  return entry?.enabled === false
    ? { enabled: false, reason: entry.reason ?? "disabled in web-tops.yaml" }
    : undefined;
}

/** The `layers.*` keys that build output stands for (WEB_TOPS.md section 7); `package_exports` runs inside gate 1. */
const BUILD_OUTPUT_KEYS: readonly LayerKey[] = [
  "size_limit",
  "html_validate",
  "axe",
  "rendered",
  "themes",
];

/** The gates whose `enabled` switch is `gates.<id>.enabled`. */
const GATE_SWITCHES = ["hygiene", "tests", "coverage", "crap", "mutation"] as const;

function mappedBuildKeys(config: WebTopsConfig): LayerKey[] {
  const mapped = profileFor(config.class)?.layers ?? [];
  return BUILD_OUTPUT_KEYS.filter((key) => mapped.includes(key));
}

/** Every mapped build layer is switched off: the reason is the config's, else a generic one. */
function allOff(config: WebTopsConfig, keys: readonly LayerKey[]): Toggle | undefined {
  const entries = keys.map((key) => config.layers?.[key]);
  if (!entries.every((entry) => entry?.enabled === false)) {
    return undefined;
  }
  const reason = entries.find((entry) => entry?.reason !== undefined)?.reason;
  return { enabled: false, reason: reason ?? "disabled in web-tops.yaml" };
}

/**
 * Build output is switched off when the class maps none of its layers, or the config switches off every
 * one the class maps. The reason is the config's, else names the class.
 */
function buildOutput(config: WebTopsConfig): Toggle | undefined {
  const keys = mappedBuildKeys(config);
  return keys.length === 0
    ? { enabled: false, reason: `class ${config.class} maps no build-output layer` }
    : allOff(config, keys);
}

function togglesOf(config: WebTopsConfig): Record<string, Toggle> {
  const entries: readonly [string, Toggle | undefined][] = [
    ...GATE_SWITCHES.map((id): [string, Toggle | undefined] => [id, off(config.gates?.[id])]),
    ["build-output", buildOutput(config)],
    ["laws", off(config.laws)],
  ];
  return Object.fromEntries(
    entries.flatMap(([id, toggle]) => (toggle === undefined ? [] : [[id, toggle]])),
  );
}

function baseOf(config: WebTopsConfig): string | undefined {
  return config.gates?.mutation?.base;
}

function customOf(config: WebTopsConfig): GateConfig["custom"] {
  return (config.layers?.custom ?? []).map(({ id, tier, command }) => ({ id, tier, command }));
}

/** Narrows a validated `web-tops.yaml` to what the runner needs (the class profile and the switches). */
export function toGateConfig(config: WebTopsConfig): GateConfig {
  const base = baseOf(config);
  return {
    protocol: config.protocol,
    package: config.package,
    class: config.class,
    enforce: config.enforce,
    ...(base === undefined ? {} : { base }),
    reportPath: config.report.path,
    toggles: togglesOf(config),
    custom: customOf(config),
  };
}
