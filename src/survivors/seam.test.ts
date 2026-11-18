import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { madeDirs, tempDir } from "../init/test-support.ts";
import { checkLedger } from "./check.ts";
import { parseFlags } from "./flags.ts";
import { keyMutants } from "./key.ts";
import type { Mutant } from "./key.ts";
import { judge } from "./match.ts";
import { readReportSurvivors } from "./reportSurvivors.ts";
import { entry, ledgerYaml, entryYaml, reportWith, CLAMP_KEY } from "./test-support.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const PROBE = fileURLToPath(new URL("../../fixtures/probe/assertion-free-test/", import.meta.url));

const read = (from: unknown, key: string): unknown =>
  typeof from === "object" && from !== null ? Reflect.get(from, key) : undefined;

function position(from: unknown): { line: number; column: number } {
  const line = read(from, "line");
  const column = read(from, "column");
  if (typeof line !== "number" || typeof column !== "number") throw new Error("bad position");
  return { line, column };
}

/** The survivors (Survived or NoCoverage) of the recorded run, keyed the way G7 will key them. */
function recordedSurvivors(source: string) {
  const recorded: unknown = JSON.parse(readFileSync(join(PROBE, "recorded/mutation.json"), "utf8"));
  const list = read(read(read(recorded, "files"), "src/total.ts"), "mutants");
  const all: unknown[] = Array.isArray(list) ? list : [];
  const toMutant = (raw: unknown): Mutant => {
    const location = read(raw, "location");
    return {
      mutatorName: String(read(raw, "mutatorName")),
      replacement: String(read(raw, "replacement")),
      location: { start: position(read(location, "start")), end: position(read(location, "end")) },
    };
  };
  const keys = keyMutants(ts, "src/total.ts", source, all.map(toMutant));
  return keys.filter((_, index) =>
    ["Survived", "NoCoverage"].includes(String(read(all[index], "status"))),
  );
}

describe("the ledger against the survivors of a real recorded run (the G7 seam)", () => {
  const source = readFileSync(join(PROBE, "src/total.ts"), "utf8");
  const survivors = recordedSurvivors(source);

  it("finds the two survivors of the assertion-free test, and counts both as unexplained with no ledger", () => {
    expect(survivors).toHaveLength(2);
    expect(judge([], survivors, "2026-11-17").unexplained).toHaveLength(2);
  });

  it("is satisfied one survivor at a time by an entry for it, which is what the profile max compares", () => {
    const [first, second] = survivors;
    if (first === undefined || second === undefined) throw new Error("expected two survivors");
    expect(judge([entry(first)], survivors, "2026-11-17").unexplained).toEqual([second]);
    expect(judge([entry(first), entry(second)], survivors, "2026-11-17").unexplained).toEqual([]);
  });

  it("still matches after lines are added above the function: a moved line keeps its entry", () => {
    const [first, second] = survivors;
    if (first === undefined || second === undefined) throw new Error("expected two survivors");
    const shifted = recordedSurvivorsShifted(source, 4);
    expect(judge([entry(first), entry(second)], shifted, "2026-11-17").unexplained).toEqual([]);
  });

  it("fails the entry, not only the survivor, once it expires", () => {
    const [first] = survivors;
    if (first === undefined) throw new Error("expected a survivor");
    const found = judge([entry(first, { expires: "2026-11-16" })], survivors, "2026-11-17");
    expect(found.expired).toHaveLength(1);
    expect(found.unexplained).toHaveLength(2);
  });
});

/** The same run on the same source with `extra` comment lines above it: every location moves down. */
function recordedSurvivorsShifted(source: string, extra: number) {
  const recorded: unknown = JSON.parse(readFileSync(join(PROBE, "recorded/mutation.json"), "utf8"));
  const list = read(read(read(recorded, "files"), "src/total.ts"), "mutants");
  const all: unknown[] = Array.isArray(list) ? list : [];
  const text = `${"// note\n".repeat(extra)}${source}`;
  const mutants = all.map((raw): Mutant => {
    const location = read(raw, "location");
    const down = (from: unknown) => ({ ...position(from), line: position(from).line + extra });
    return {
      mutatorName: String(read(raw, "mutatorName")),
      replacement: String(read(raw, "replacement")),
      location: { start: down(read(location, "start")), end: down(read(location, "end")) },
    };
  });
  return keyMutants(ts, "src/total.ts", text, mutants).filter((_, index) =>
    ["Survived", "NoCoverage"].includes(String(read(all[index], "status"))),
  );
}

describe("readReportSurvivors", () => {
  const write = (text: string): string => {
    const dir = tempDir();
    mkdirSync(join(dir, ".web-tops"));
    const path = join(dir, ".web-tops", "report.json");
    writeFileSync(path, text);
    return path;
  };

  it("reads the survivor objects on the mutation layer's findings", () => {
    expect(readReportSurvivors(write(reportWith(CLAMP_KEY)))).toEqual({
      ok: true,
      survivors: [CLAMP_KEY],
    });
  });

  it("ignores findings with no survivor object, a survivor missing a field, and other layers", () => {
    const report = JSON.stringify({
      layers: [
        { id: "tests", findings: [{ survivor: CLAMP_KEY }] },
        {
          id: "mutation",
          findings: [
            { rule: "x" },
            { survivor: { file: "a" } },
            { survivor: { ...CLAMP_KEY, occurrence: "1" } },
          ],
        },
      ],
    });
    expect(readReportSurvivors(write(report))).toEqual({ ok: true, survivors: [] });
  });

  it("says a report is absent, or is not JSON, in different words", () => {
    const absent = readReportSurvivors(join(tempDir(), "nope.json"));
    expect(!absent.ok && absent.absent).toBe(true);
    const broken = readReportSurvivors(write("{ not json"));
    expect(!broken.ok && broken.absent).toBe(false);
  });
});

describe("checkLedger", () => {
  it("is quiet for no file and for a valid one, and names each problem otherwise", () => {
    const quiet = tempDir();
    expect(checkLedger(quiet)).toEqual([]);
    const bad = tempDir();
    mkdirSync(join(bad, ".web-tops"));
    writeFileSync(
      join(bad, ".web-tops", "survivors.yaml"),
      ledgerYaml(entryYaml(CLAMP_KEY, ["reason: r"])),
    );
    expect(checkLedger(bad)).toEqual([
      { pointer: "/survivors/0/owner", message: "owner is missing" },
    ]);
  });

  it("follows a ledger path it is given", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "l.yaml"), ledgerYaml(entryYaml(CLAMP_KEY, ["owner: o"])));
    expect(checkLedger(dir, "l.yaml")[0]?.pointer).toBe("/survivors/0/reason");
  });
});

describe("parseFlags", () => {
  const spec = { values: ["--reason"], switches: ["--json"] };

  it("splits words, values and switches, and reads both spellings of a value", () => {
    const flags = parseFlags(["a", "--reason", "x y", "--json", "b", "--reason=z"], spec);
    expect(typeof flags).not.toBe("string");
    if (typeof flags === "string") return;
    expect(flags.positionals).toEqual(["a", "b"]);
    expect(flags.values.get("--reason")).toBe("z");
    expect(flags.switches.has("--json")).toBe(true);
  });

  it("keeps an `=` that is inside a value", () => {
    const flags = parseFlags(["--reason=a=b"], spec);
    expect(typeof flags !== "string" && flags.values.get("--reason")).toBe("a=b");
  });

  it("names an option it does not know, and a value that is missing", () => {
    expect(parseFlags(["--nope"], spec)).toBe("unknown option --nope");
    expect(parseFlags(["--reason"], spec)).toBe("--reason needs a value");
  });
});
