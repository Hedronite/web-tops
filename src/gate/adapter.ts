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

/**
 * Build output is switched off when the class maps none of its layers, or the config switches off every
 * one the class maps. The reason is the config's, else names the class.
 */
function buildOutput(config: WebTopsConfig): Toggle | undefined {
  const mapped = profileFor(config.class)?.layers ?? [];
  const keys = BUILD_OUTPUT_KEYS.filter((key) => mapped.includes(key));
  if (keys.length === 0) {
    return { enabled: false, reason: `class ${config.class} maps no build-output layer` };
  }
  const entries = keys.map((key) => config.layers?.[key]);
  if (entries.every((entry) => entry?.enabled === false)) {
    return {
      enabled: false,
      reason:
        entries.find((entry) => entry?.reason !== undefined)?.reason ?? "disabled in web-tops.yaml",
    };
  }
  return undefined;
}

/** Narrows a validated `web-tops.yaml` to what the runner needs (the class profile and the switches). */
export function toGateConfig(config: WebTopsConfig): GateConfig {
  const entries: readonly [string, Toggle | undefined][] = [
    ["hygiene", off(config.gates?.hygiene)],
    ["tests", off(config.gates?.tests)],
    ["coverage", off(config.gates?.coverage)],
    ["crap", off(config.gates?.crap)],
    ["mutation", off(config.gates?.mutation)],
    ["build-output", buildOutput(config)],
    ["laws", off(config.laws)],
  ];
  const toggles: Record<string, Toggle> = {};
  for (const [id, toggle] of entries) {
    if (toggle !== undefined) {
      toggles[id] = toggle;
    }
  }
  const base = config.gates?.mutation?.base;
  return {
    protocol: config.protocol,
    package: config.package,
    class: config.class,
    enforce: config.enforce,
    ...(base === undefined ? {} : { base }),
    reportPath: config.report.path,
    toggles,
    custom: (config.layers?.custom ?? []).map(({ id, tier, command }) => ({ id, tier, command })),
  };
}
