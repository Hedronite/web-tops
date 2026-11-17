import type { GateRef } from "../report/types.ts";
import type { Layer, Tier } from "./types.ts";

const ALL_LAUNCH_CLASSES = ["ts-library", "ui-components", "astro-site", "web-app", "node-service"];

/**
 * A registered layer whose reader is not built yet. Enabled, it reports `not-run` and the gate fails
 * (WEB_TOPS.md section 3.3); it never passes silently. The config disables it with a reason until it lands.
 */
export function stubLayer(
  id: string,
  gate: GateRef,
  tier: Tier,
  lands: string,
  requires: readonly string[] = [],
): Layer {
  return {
    id,
    gate,
    tier,
    classes: ALL_LAUNCH_CLASSES,
    requires,
    produces: [],
    consumes: [],
    run: () =>
      Promise.resolve({
        verdict: "not-run",
        reason: `${id} lands in ${lands}`,
        findings: [],
        artifacts: {},
      }),
  };
}

/** Gates 4 to 6 and the laws layer: later milestones (WEB_TOPS.md section 19). */
export const CRAP_STUB = stubLayer("crap", 4, 1, "M2");
export const MUTATION_STUB = stubLayer("mutation", 5, 1, "M2");
export const BUILD_OUTPUT_STUB = stubLayer("build-output", 6, 1, "M4");
export const LAWS_STUB = stubLayer("laws", "laws", 0, "M3", ["hygiene"]);

/** A custom layer (WEB_TOPS.md section 7): unmapped is `not-run`; running one is M4's work. */
export function customLayer(id: string, tier: Tier, command: string | undefined): Layer {
  return {
    id,
    gate: 6,
    tier,
    classes: ALL_LAUNCH_CLASSES,
    requires: [],
    produces: [],
    consumes: [],
    run: () =>
      Promise.resolve({
        verdict: "not-run",
        reason:
          command === undefined
            ? "no command is mapped to this layer"
            : "custom layers run from M4",
        findings: [],
        artifacts: {},
      }),
  };
}
