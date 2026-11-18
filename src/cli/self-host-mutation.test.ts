import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * M2 G10: the kit gates itself with CRAP and mutation at `hard`, in the one `gate` job. This file reads the kit's own
 * config as data and imports nothing of the kit, so that a change to it adds nothing to the mutation scope. The limits
 * it states are the ts-library profile's (WEB_TOPS.md section 5.2); the profile tests hold the profile to the text.
 */

const root = resolve(import.meta.dirname, "../..");

function yamlOf(name: string): unknown {
  return parse(readFileSync(join(root, name), "utf8"));
}

/** The value at a path of keys, or undefined where there is none. */
function at(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (node, key) => (typeof node === "object" && node !== null ? Reflect.get(node, key) : undefined),
    value,
  );
}

/** The keys of an object value. */
const keysOf = (value: unknown): string[] =>
  typeof value === "object" && value !== null ? Object.keys(value) : [];

const TS_LIBRARY = { crapCap: 4, unexplainedSurvivorsMax: 0 };

describe("G10a: the kit runs mutation on the diff under hard", () => {
  it("is on, scoped to the diff against origin/main, with the class's survivor maximum and a ledger", () => {
    const mutation = at(yamlOf("web-tops.yaml"), ["gates", "mutation"]);
    expect(at(mutation, ["enabled"])).not.toBe(false);
    expect(at(mutation, ["engine"])).toBe("stryker");
    expect(at(mutation, ["scope"])).toBe("diff");
    expect(at(mutation, ["base"])).toBe("origin/main");
    expect(at(mutation, ["unexplained_survivors_max"])).toBe(TS_LIBRARY.unexplainedSurvivorsMax);
    expect(at(mutation, ["ledger"])).toBe(".web-tops/survivors.yaml");
  });

  it("keeps CRAP on beside it at the class's cap, and switches neither off", () => {
    const gates = at(yamlOf("web-tops.yaml"), ["gates"]);
    for (const gate of ["crap", "mutation"]) {
      expect(at(gates, [gate, "enabled"]), gate).not.toBe(false);
      expect(at(gates, [gate, "reason"]), gate).toBeUndefined();
    }
    expect(at(gates, ["crap", "cap"])).toBe(TS_LIBRARY.crapCap);
  });

  it("runs in one gate job, once, on both operating systems", () => {
    const workflow = yamlOf(".github/workflows/web-tops.yml");
    const jobs = at(workflow, ["jobs"]);
    expect(keysOf(jobs)).toEqual(["gate"]);
    const steps = at(workflow, ["jobs", "gate", "steps"]);
    const runs = Array.isArray(steps) ? steps.map((step) => at(step, ["run"])) : [];
    expect(runs.filter((run) => run === "bun src/cli/main.ts gate --max-tier 1")).toHaveLength(1);
    expect(at(workflow, ["jobs", "gate", "strategy", "matrix", "os"])).toEqual([
      "ubuntu-latest",
      "macos-latest",
    ]);
  });

  it("gives the gate job room for a mutation run", () => {
    const minutes = at(yamlOf(".github/workflows/web-tops.yml"), [
      "jobs",
      "gate",
      "timeout-minutes",
    ]);
    expect(typeof minutes === "number" && minutes >= 30).toBe(true);
  });
});
