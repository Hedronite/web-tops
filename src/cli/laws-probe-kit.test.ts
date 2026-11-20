import { afterAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { lawsOfClass } from "../laws/probe/catalog.ts";
import { kitProbeLaws } from "../laws/probe/testkit.ts";
import { cleanTemp } from "../laws/probe/testkit.ts";
import { KIT, probeProcess } from "./test-support-probe.ts";

afterAll(cleanTemp);

const kitLaws = lawsOfClass(kitProbeLaws(), "ts-library").length;

/** The probe on this repository, under its own eslint.config.js and tsconfig.json, with the twins it ships. */
describe("G3c `laws probe` on the kit itself", () => {
  it(
    "passes every law the probe proves, under the kit's own config",
    () => {
      const run = probeProcess(KIT);
      expect(run.err).toBe("");
      expect(run.out).toContain(`${String(kitLaws)} of ${String(kitLaws)} laws probed pass`);
      expect(run.code).toBe(0);
    },
    REAL_TOOL_TIMEOUT,
  );
});
