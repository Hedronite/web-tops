import { compareGates } from "./order.ts";
import {
  BUILD_OUTPUT_STUB,
  COVERAGE_STUB,
  CRAP_STUB,
  customLayer,
  HYGIENE_STUB,
  LAWS_STUB,
  MUTATION_STUB,
  TESTS_STUB,
} from "./stubs.ts";
import type { GateConfig, Layer } from "./types.ts";

/** The layers of one run: the seven built-ins and the config's custom layers, in gate order. */
export function buildRegistry(config: GateConfig): Layer[] {
  const custom = config.custom.map((entry) => customLayer(entry.id, entry.tier, entry.command));
  return [
    HYGIENE_STUB,
    TESTS_STUB,
    COVERAGE_STUB,
    CRAP_STUB,
    MUTATION_STUB,
    BUILD_OUTPUT_STUB,
    ...custom,
    LAWS_STUB,
  ].sort((a, b) => compareGates(a.gate, b.gate));
}
