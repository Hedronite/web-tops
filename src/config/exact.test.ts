import { rmSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { readProject } from "./project.ts";
import { validateReport } from "./report.ts";
import { runSemanticChecks } from "./semantic.ts";
import { edit } from "./test-support.ts";
import { buildReport } from "./test-support-report.ts";
import type { Problem, WebTopsConfig } from "./types.ts";
import { parseConfig } from "./validate.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

const HEAD = 'protocol: "0.3.0"\nversion: "0.1.0"\npackage: pkg\n';

function config(body: string): WebTopsConfig {
  const parsed = parseConfig(`${HEAD}${body}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return parsed.value;
}

const NO_ASTRO = { dependsOnAstro: false };

function problems(body: string, today = "2026-06-15"): readonly Problem[] {
  return runSemanticChecks(config(body), { cwd: tempDir(), today, project: NO_ASTRO });
}

describe("the semantic checks: the messages", () => {
  it("says ts-library keeps no unexplained survivors", () => {
    expect(
      problems(
        "class: ts-library\nenforce: ratchet\ngates:\n  mutation: { unexplained_survivors_max: 1 }\n",
      ),
    ).toContainEqual({
      pointer: "/gates/mutation/unexplained_survivors_max",
      message: "ts-library keeps unexplained_survivors_max = 0",
    });
  });

  it("says advisory needs an exemption", () => {
    expect(problems("class: ts-library\nenforce: advisory\n")).toEqual([
      { pointer: "/exemption", message: "advisory needs an exemption (until and reason)" },
    ]);
  });

  it("names the gate that hard refuses to see switched off, with dots", () => {
    expect(
      problems(
        "class: ts-library\nenforce: hard\ngates:\n  hygiene:\n    eslint: { enabled: false, reason: r }\n",
      ),
    ).toContainEqual({
      pointer: "/gates/hygiene/eslint/enabled",
      message:
        "under hard, gates.hygiene.eslint is mapped by class ts-library and cannot be switched off",
    });
  });

  it("names a custom layer id that is already taken, by its place", () => {
    const layer = (id: string): string => `    - { id: ${id}, tier: 2, command: "true" }\n`;
    const body = `class: ts-library\nenforce: ratchet\nlayers:\n  custom:\n${layer("mine")}${layer("mine")}`;
    expect(problems(body)).toEqual([
      { pointer: "/layers/custom/1/id", message: 'layer id "mine" is already taken' },
    ]);
  });

  it("says a looser survivors maximum is above the class's", () => {
    expect(
      problems(
        "class: web-app\nenforce: hard\ngates:\n  mutation: { unexplained_survivors_max: 9 }\n",
      ),
    ).toContainEqual({
      pointer: "/gates/mutation/unexplained_survivors_max",
      message: "under hard, unexplained_survivors_max is above class web-app's 2",
    });
  });
});

describe("the semantic checks: what they leave alone", () => {
  it("lets an exemption run through today, UTC, when no date is passed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T23:59:59Z"));
    const body =
      'class: ts-library\nenforce: advisory\nexemption: { until: "2026-06-15", reason: r }\n';
    const found = runSemanticChecks(config(body), { cwd: tempDir(), project: NO_ASTRO });
    expect(found).toEqual([]);
    vi.setSystemTime(new Date("2026-06-16T00:00:00Z"));
    expect(runSemanticChecks(config(body), { cwd: tempDir(), project: NO_ASTRO })).toEqual([
      { pointer: "/exemption/until", message: "the exemption ended on 2026-06-15" },
    ]);
  });

  it("does not look at the baseline unless the mode is ratchet", () => {
    const cwd = tempDir();
    put(cwd, ".web-tops/baseline.json", "{}\n");
    const body = "class: ts-library\nenforce: hard\nbaseline: .web-tops/baseline.json\n";
    const found = runSemanticChecks(config(body), { cwd, today: "2026-06-15", project: NO_ASTRO });
    expect(found.filter((problem) => problem.pointer === "/baseline")).toEqual([]);
  });
});

describe("readProject: a package.json that is JSON null", () => {
  it("reads as a project with nothing declared", () => {
    const dir = tempDir();
    put(dir, "package.json", "null");
    expect(readProject(dir)).toEqual({ dependsOnAstro: false, isPrivate: false });
  });
});

describe("parseConfig: a YAML document that cannot be turned into a value", () => {
  it("is refused at the root, with the library's words", () => {
    const aliases = Array.from({ length: 400 }, () => "*a").join(", ");
    const text = `a: &a [1, 2, 3]\nb: &b [${aliases}]\nc: [${Array.from({ length: 50 }, () => "*b").join(", ")}]\n`;
    expect(parseConfig(text)).toEqual({
      ok: false,
      problems: [
        { pointer: "", message: "Excessive alias count indicates a resource exhaustion attack" },
      ],
    });
  });
});

describe("validateReport: a failed count that disagrees with the layers", () => {
  it("names the verdicts that end the run", () => {
    expect(validateReport(edit(buildReport(), ["counts", "failed"], 3))).toEqual({
      ok: false,
      problems: [
        {
          pointer: "/counts/failed",
          message:
            "counts 3 failed layers (fail, refuse, ack-missing, not-run, and a required not-evaluated), the layers hold 0",
        },
      ],
    });
  });
});

describe("validateReport: the other messages", () => {
  const messages = (report: unknown): readonly { pointer: string; message: string }[] => {
    const result = validateReport(report);
    return result.ok ? [] : result.problems;
  };

  it("says how many not-evaluated layers were claimed and held", () => {
    expect(messages(edit(buildReport(), ["counts", "not_evaluated"], 4))).toEqual([
      {
        pointer: "/counts/not_evaluated",
        message: "counts 4 not-evaluated layers, the layers hold 0",
      },
    ]);
    expect(messages(edit(buildReport(), ["counts", "required_not_evaluated"], 4))).toEqual([
      {
        pointer: "/counts/required_not_evaluated",
        message: "counts 4 required not-evaluated layers, the layers hold 0",
      },
    ]);
  });

  it("says more layers ran than are in range", () => {
    const report = edit(edit(buildReport(), ["counts", "ran"], 99), ["counts", "in_range"], 5);
    expect(messages(report)).toContainEqual({
      pointer: "/counts/ran",
      message: "more layers ran than are in range",
    });
  });

  it("says enforced is false exactly when enforce is advisory", () => {
    expect(messages(edit(buildReport(), ["enforced"], false))).toEqual([
      { pointer: "/enforced", message: "enforced is false exactly when enforce is advisory" },
    ]);
  });

  it("says a layer's finding counts are not those of its findings", () => {
    const wrong = [{ rule: "r", file: "f", count: 3 }];
    expect(messages(edit(buildReport(), ["layers", "0", "metrics", "findings"], wrong))).toEqual([
      {
        pointer: "/layers/0/metrics/findings",
        message: "counts per rule per file are not those of the layer's findings",
      },
    ]);
  });

  it("names a layer id that appears twice", () => {
    const report = buildReport();
    const twice = { ...report, layers: [...report.layers, ...report.layers.slice(0, 1)] };
    expect(messages(twice)).toContainEqual({
      pointer: "/layers",
      message: 'layer "hygiene" appears more than once',
    });
  });
});

describe("the semantic checks: an exemption date that is not a date", () => {
  it("says so, with the text", () => {
    const body =
      'class: ts-library\nenforce: advisory\nexemption: { until: "2026-02-30", reason: r }\n';
    expect(problems(body)).toEqual([
      { pointer: "/exemption/until", message: "2026-02-30 is not a calendar date" },
    ]);
  });
});

describe("validateReport: a passed flag that disagrees with the layers", () => {
  const messages = (report: unknown): readonly { pointer: string; message: string }[] => {
    const result = validateReport(report);
    return result.ok ? [] : result.problems;
  };
  const every = (verdict: "skip" | "pass"): Parameters<typeof buildReport>[0] => ({
    hygiene: verdict,
    tests: verdict,
    coverage: verdict,
    crap: verdict,
    mutation: verdict,
    "build-output": verdict,
    laws: verdict,
  });

  it("says a clean run passed", () => {
    expect(messages(edit(buildReport(), ["passed"], false))).toEqual([
      {
        pointer: "/passed",
        message: "no layer failed and every layer in range ran, so the run passed",
      },
    ]);
  });

  it("says an empty run is not a pass", () => {
    expect(messages(edit(buildReport(every("skip")), ["passed"], true))).toEqual([
      {
        pointer: "/passed",
        message: "no layer was in range, so the run did not pass: an empty run is not a pass",
      },
    ]);
  });

  it("says a failed layer means the run did not pass", () => {
    expect(messages(edit(buildReport({ crap: "fail" }), ["passed"], true))).toEqual([
      {
        pointer: "/passed",
        message:
          "a layer failed or was not evaluated, or fewer layers ran than are in range, so the run did not pass",
      },
    ]);
  });
});
