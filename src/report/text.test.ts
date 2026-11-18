import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReport } from "../gate/testkit.ts";
import type { Report, ReportLayer } from "./types.ts";
import { formatText } from "./text.ts";

/** G1d, G1e: the printer speaks the eight verdicts, and a stopped run prints the laws mapping for what ran. */

function fixture(name: string): Report {
  return parseReport(
    readFileSync(resolve(import.meta.dirname, "../../fixtures/report", `${name}.json`), "utf8"),
  );
}

const STOPPED = "stopped: gate 2 failed";

/** The refuse fixture, with tests failed and gates 3 to 6 not run: the shape of a run stopped at gate 2. */
function stopped(): Report {
  const base = fixture("refuse");
  const layers = base.layers.map((layer): ReportLayer => {
    if (layer.id === "tests") {
      return { ...layer, verdict: "fail", findings: [] };
    }
    return ["coverage", "crap", "mutation", "build-output"].includes(layer.id)
      ? { ...layer, verdict: "not-run", reason: STOPPED }
      : layer;
  });
  return { ...base, layers };
}

describe("G1e formatText prints every verdict of section 3.3", () => {
  it.each(["pass", "fail", "refuse", "ack-missing", "skip", "not-run", "not-evaluated", "vacuous"])(
    "prints a layer that is %s, with its verdict in the verdict column",
    (verdict) => {
      const text = formatText(fixture(verdict));
      expect(text).toMatch(new RegExp(`tier 1  ${verdict}`, "u"));
    },
  );

  it("keeps the verdict and the reason apart on a long verdict", () => {
    const text = formatText(fixture("not-evaluated"));
    expect(text).toContain("tier 1  not-evaluated a law has no reader yet");
  });
});

describe("G1d a stopped run prints the laws mapping for what ran", () => {
  it("prints the laws findings in a block that names the layers they were read from", () => {
    const text = formatText(stopped());
    expect(text).toContain("laws mapping (from hygiene, tests):");
    expect(text).toContain(
      "      - [refuse] TS1294: enum declaration is forbidden (src/state.ts:4)",
    );
  });

  it("prints each law finding once, in the block and not again under the laws layer", () => {
    const text = formatText(stopped());
    expect(text.split("TS1294").length - 1).toBe(1);
  });

  it("prints no block when the laws layer has no findings", () => {
    expect(formatText(fixture("fail"))).not.toContain("laws mapping");
  });

  it("names none when no other layer ran", () => {
    const base = stopped();
    const layers = base.layers.map((layer): ReportLayer =>
      layer.id === "laws" ? layer : { ...layer, verdict: "not-run", reason: STOPPED },
    );
    expect(formatText({ ...base, layers })).toContain("laws mapping (from none):");
  });
});
