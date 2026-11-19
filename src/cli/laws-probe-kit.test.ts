import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";
import { interimLaws, lawsOfClass } from "../laws/probe/catalog.ts";
import type { Io } from "./io.ts";
import { runLawsProbeCli } from "./laws-probe.ts";

const KIT = resolve(import.meta.dirname, "../..");
const kitLaws = lawsOfClass(interimLaws(), "ts-library").length;

/** The probe on this repository, under its own eslint.config.js and tsconfig.json, with the twins it ships. */
describe("G3c `laws probe` on the kit itself", () => {
  it(
    "passes every law the probe proves, under the kit's own config",
    async () => {
      const out: string[] = [];
      const err: string[] = [];
      const io: Io = {
        out: (t) => out.push(t),
        err: (t) => err.push(t),
        cwd: KIT,
        env: process.env,
      };
      const code = await runLawsProbeCli([], io);
      expect(err.join("")).toBe("");
      expect(out.join("")).toContain(`${String(kitLaws)} of ${String(kitLaws)} laws probed pass`);
      expect(code).toBe(0);
    },
    REAL_TOOL_TIMEOUT,
  );
});
