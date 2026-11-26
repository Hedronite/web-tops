import type { Layer } from "../../gate/types.ts";
import { ensureBuild } from "./run.ts";

export { resolveDistDir, routeForHtml, scanDist, type DistInventory } from "./inventory.ts";
export {
  BUILD_TIMEOUT_MS,
  ensureBuild,
  ensureServer,
  readInventoryArtifact,
  type EnsureBuildOptions,
} from "./run.ts";
export { BROTLI_OPTIONS, mimeType, startStaticServer } from "./server.ts";

/** Gate 6 shared build layer: builds `dist/` once and hands off its page inventory via N5 artifact. */
export const buildLayer: Layer = {
  id: "build",
  gate: 6,
  tier: 1,
  classes: ["ui-components", "astro-site", "web-app"],
  requires: [],
  produces: ["inventory"],
  consumes: [],
  run: async (context) => {
    const result = await ensureBuild(context);
    if (!result.ok) {
      return {
        verdict: "fail",
        reason: result.reason,
        findings: result.findings,
        artifacts: {},
      };
    }
    return {
      verdict: "pass",
      findings: [],
      artifacts: { inventory: result.manifestPath },
    };
  },
};
