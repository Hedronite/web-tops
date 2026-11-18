import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTypeScript } from "../../complexity/index.ts";
import { keyString } from "../../survivors/key.ts";
import { readMutation } from "./read.ts";

/** G7a: the mutation report is read through the P3 status table, and each survivor is keyed (WEB_TOPS.md section 6.4). */

const root = resolve(import.meta.dirname, "../../..");
const ts = loadTypeScript(root);
const probe = resolve(root, "fixtures/probe");

function recorded(id: string): unknown {
  const value: unknown = JSON.parse(
    readFileSync(resolve(probe, id, "recorded/mutation.json"), "utf8"),
  );
  return value;
}

function sourceOf(id: string): (file: string) => string | undefined {
  return (file) => readFileSync(resolve(probe, id, file), "utf8");
}

/** A one-file report whose mutants all sit in `text`, with the given statuses, one `n > 0` condition each. */
function report(statuses: readonly string[]): unknown {
  const mutants = statuses.map((status, index) => ({
    id: String(index),
    mutatorName: "ConditionalExpression",
    replacement: "true",
    status,
    location: { start: { line: 2, column: 10 }, end: { line: 2, column: 15 } },
  }));
  return { files: { "src/a.ts": { mutants } } };
}

const TEXT = "export function a(n: number): number {\n  return n > 0 ? 1 : 2;\n}\n";

function read(statuses: readonly string[]): ReturnType<typeof readMutation> {
  return readMutation({ ts, report: report(statuses), text: () => TEXT });
}

describe("G7a the P3 status table", () => {
  it.each([
    ["Killed", { killed: 1, survivors: 0, excluded: 0 }],
    ["Timeout", { killed: 1, survivors: 0, excluded: 0 }],
    ["Survived", { killed: 0, survivors: 1, excluded: 0 }],
    ["NoCoverage", { killed: 0, survivors: 1, excluded: 0 }],
    ["CompileError", { killed: 0, survivors: 0, excluded: 1 }],
    ["RuntimeError", { killed: 0, survivors: 0, excluded: 1 }],
    ["Ignored", { killed: 0, survivors: 0, excluded: 1 }],
  ])("%s counts as %j", (status, expected) => {
    const found = read([status]);
    expect({
      killed: found.killed,
      survivors: found.survivors.length,
      excluded: found.excluded,
    }).toEqual(expected);
    expect(found.unknown).toEqual([]);
  });

  it.each(["Pending", "Weird", ""])(
    "a status the table does not list, %j, is reported by name and counted nowhere",
    (status) => {
      const found = read([status, "Killed"]);
      expect(found.unknown).toEqual([status]);
      expect(found.killed).toBe(1);
      expect(found.survivors).toEqual([]);
    },
  );

  it("lists an unknown status once, however many mutants have it", () => {
    expect(read(["Pending", "Pending", "Weird"]).unknown).toEqual(["Pending", "Weird"]);
  });

  it("counts NoCoverage with Survived, so the least tested function does not score best", () => {
    expect(read(["Survived", "NoCoverage", "Killed"]).survivors.map((item) => item.status)).toEqual(
      ["Survived", "NoCoverage"],
    );
  });
});

const NONE = {
  killed: 0,
  timeout: 0,
  survived: 0,
  no_coverage: 0,
  runtime_error: 0,
  compile_error: 0,
  ignored: 0,
};

describe("R75 a count for each Stryker status, so a status that moves between runs is seen", () => {
  it.each([
    ["Killed", "killed"],
    ["Timeout", "timeout"],
    ["Survived", "survived"],
    ["NoCoverage", "no_coverage"],
    ["RuntimeError", "runtime_error"],
    ["CompileError", "compile_error"],
    ["Ignored", "ignored"],
  ])("%s is counted as %s, and nothing else", (status, key) => {
    expect(read([status]).counts).toEqual({ ...NONE, [key]: 1 });
  });

  it("counts every mutant once, by its own status", () => {
    const found = read([
      "Killed",
      "Killed",
      "Timeout",
      "Survived",
      "NoCoverage",
      "Ignored",
      "Killed",
    ]);
    expect(found.counts).toEqual({
      ...NONE,
      killed: 3,
      timeout: 1,
      survived: 1,
      no_coverage: 1,
      ignored: 1,
    });
  });

  it("counts a status the table does not list nowhere, and gives zeros for no mutant", () => {
    expect(read(["Pending"]).counts).toEqual(NONE);
    expect(read([]).counts).toEqual(NONE);
  });

  it("the recorded reports hold the counts the P3 recordings held", () => {
    const counts = (id: string): unknown =>
      readMutation({ ts, report: recorded(id), text: sourceOf(id) }).counts;
    expect(counts("no-coverage-survivors")).toEqual({
      ...NONE,
      killed: 8,
      no_coverage: 6,
      compile_error: 2,
    });
    expect(counts("assertion-free-test")).toEqual({ ...NONE, survived: 2, compile_error: 1 });
    expect(counts("stryker-disable")).toEqual({ ...NONE, killed: 1, ignored: 4, compile_error: 1 });
  });
});

describe("G7a every mutant is keyed, so a killed neighbour does not move a survivor's key", () => {
  it("numbers the occurrence over all the mutants of the same mutation, not only the survivors", () => {
    const found = read(["Killed", "Survived"]);
    expect(found.survivors).toHaveLength(1);
    expect(found.survivors[0]?.key.occurrence).toBe(2);
  });

  it("gives the six fields: file, scored unit, mutator, original, replacement, occurrence", () => {
    const [first] = read(["Survived"]).survivors;
    expect(first?.key).toEqual({
      file: "src/a.ts",
      function: "src/a.ts::a",
      mutator: "ConditionalExpression",
      original: "n > 0",
      replacement: "true",
      occurrence: 1,
    });
    expect(first).toMatchObject({ file: "src/a.ts", line: 2 });
  });

  it("the keys of survivors are distinct", () => {
    const keys = read(["Survived", "Survived", "NoCoverage"]).survivors.map((item) =>
      keyString(item.key),
    );
    expect(new Set(keys).size).toBe(3);
  });
});

describe("G7a the recorded Stryker reports of fixtures/probe", () => {
  it("no-coverage-survivors: the six NoCoverage mutants are survivors, all in the function no test runs", () => {
    const found = readMutation({
      ts,
      report: recorded("no-coverage-survivors"),
      text: sourceOf("no-coverage-survivors"),
    });
    expect({
      killed: found.killed,
      survivors: found.survivors.length,
      excluded: found.excluded,
    }).toEqual({
      killed: 8,
      survivors: 6,
      excluded: 2,
    });
    expect(found.survivors.every((item) => item.status === "NoCoverage")).toBe(true);
    expect(found.survivors.every((item) => item.key.function === "src/price.ts::untested")).toBe(
      true,
    );
    expect(found.unknown).toEqual([]);
  });

  it("test-only-diff and assertion-free-test: the two Survived mutants count", () => {
    for (const [id, fn] of [
      ["test-only-diff", "src/sum.ts::sum"],
      ["assertion-free-test", "src/total.ts::total"],
    ] as const) {
      const found = readMutation({ ts, report: recorded(id), text: sourceOf(id) });
      expect(found.survivors).toHaveLength(2);
      expect(found.survivors.every((item) => item.key.function === fn)).toBe(true);
    }
  });

  it("stryker-disable: the four Ignored mutants are excluded, so there is no survivor", () => {
    const found = readMutation({
      ts,
      report: recorded("stryker-disable"),
      text: sourceOf("stryker-disable"),
    });
    expect(found.survivors).toEqual([]);
    expect(found.excluded).toBe(5);
  });
});

describe("G7a a mutant that is not one is an error", () => {
  const at = (line: unknown, column: unknown): unknown => ({ line, column });
  const mutant = (over: Record<string, unknown>): unknown => ({
    files: {
      "src/a.ts": {
        mutants: [
          {
            mutatorName: "ConditionalExpression",
            replacement: "true",
            status: "Survived",
            location: { start: at(2, 10), end: at(2, 15) },
            ...over,
          },
        ],
      },
    },
  });

  it.each([
    ["no position", { location: { start: { line: 2 }, end: at(2, 15) } }],
    ["a position that is not a number", { location: { start: at("2", 10), end: at(2, 15) } }],
    ["no location", { location: undefined }],
    ["no mutator", { mutatorName: undefined }],
    ["no replacement", { replacement: 3 }],
  ])("a mutant with %s", (_label, over) => {
    expect(() => readMutation({ ts, report: mutant(over), text: () => TEXT })).toThrow(
      /mutation report/u,
    );
  });

  it("a mutant with no status is reported as an unknown status, named as empty", () => {
    expect(
      readMutation({ ts, report: mutant({ status: undefined }), text: () => TEXT }).unknown,
    ).toEqual([""]);
  });

  it("a file entry with no mutants list", () => {
    expect(() =>
      readMutation({ ts, report: { files: { "src/a.ts": { mutants: 3 } } }, text: () => TEXT }),
    ).toThrow(/src\/a\.ts has no mutants/u);
  });
});

describe("G7a a report that cannot be read is an error, not an empty pass", () => {
  it.each([null, 3, "text", [], {}, { files: 3 }, { files: { "src/a.ts": 3 } }])(
    "%j has no mutants to read",
    (bad) => {
      expect(() => readMutation({ ts, report: bad, text: () => TEXT })).toThrow(/mutation report/u);
    },
  );

  it("names a file whose source cannot be read", () => {
    expect(() => readMutation({ ts, report: report(["Survived"]), text: () => undefined })).toThrow(
      /src\/a\.ts/u,
    );
  });
});
