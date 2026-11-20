import { coverageLayer } from "../layers/coverage/index.ts";
import { crapLayer } from "../layers/crap/index.ts";
import { yamlCatalog } from "../laws/layer/catalog.ts";
import { lawsLayer } from "../laws/layer/index.ts";
import { mutationLayer } from "../layers/mutation/index.ts";
import { hygieneLayer } from "../layers/hygiene/index.ts";
import { testsLayer } from "../layers/tests/index.ts";
import { BUILD_OUTPUT_STUB, customLayer } from "./stubs.ts";
import type { GateConfig, Layer } from "./types.ts";

/** The layers of one run: the seven built-ins and the config's custom layers, in gate order. */
export function buildRegistry(config: GateConfig): Layer[] {
  const custom = config.custom.map((entry) => customLayer(entry.id, entry.tier, entry.command));
  return [
    hygieneLayer,
    testsLayer,
    coverageLayer,
    crapLayer,
    mutationLayer,
    BUILD_OUTPUT_STUB,
    ...custom,
    lawsLayer(yamlCatalog),
  ];
}
