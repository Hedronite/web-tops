import { afterEach, describe, expect, it } from "vitest";
import type { Exec } from "../../gate/types.ts";
import { fakeExec, prepare, type Prepared } from "../../layers/hygiene/testkit.ts";
import { knipReader, readKnip, runKnip } from "./knip.ts";
import { inputFor, lawOf } from "./testkit.ts";

const prepared: Prepared[] = [];

afterEach(() => {
  for (const item of prepared.splice(0)) {
    item.project.cleanup();
  }
});

function setup(files: Record<string, string> = {}, options = {}): Prepared {
  const item = prepare(files, options);
  prepared.push(item);
  return item;
}

const LAW = lawOf("W-48", [{ tool: "knip", name: "knip" }], { severity: "A" });

const report = (issues: readonly object[]): string => JSON.stringify({ issues });
const issue = (file: string, extra: object): object => ({ file, ...extra });

describe("readKnip: the unused files, exports, types and dependencies", () => {
  it("reads one finding for each unused item, with its file and, when knip gives one, its line", () => {
    const text = report([
      issue("unused.ts", { files: [{ name: "unused.ts" }] }),
      issue("utils.ts", {
        exports: [{ name: "gone", line: 2 }],
        types: [{ name: "Gone", line: 5 }],
      }),
      issue("package.json", {
        dependencies: [{ name: "lodash" }],
        devDependencies: [{ name: "vitest" }],
        optionalPeerDependencies: [{ name: "react" }],
      }),
    ]);
    expect(readKnip(text)).toEqual([
      {
        tool: "knip",
        rule: "knip:files",
        verdict: "refuse",
        message: "unused file unused.ts",
        file: "unused.ts",
      },
      {
        tool: "knip",
        rule: "knip:exports",
        verdict: "refuse",
        message: "unused export gone",
        file: "utils.ts",
        line: 2,
      },
      {
        tool: "knip",
        rule: "knip:types",
        verdict: "refuse",
        message: "unused type Gone",
        file: "utils.ts",
        line: 5,
      },
      {
        tool: "knip",
        rule: "knip:dependencies",
        verdict: "refuse",
        message: "unused dependency lodash",
        file: "package.json",
      },
      {
        tool: "knip",
        rule: "knip:devDependencies",
        verdict: "refuse",
        message: "unused devDependency vitest",
        file: "package.json",
      },
      {
        tool: "knip",
        rule: "knip:optionalPeerDependencies",
        verdict: "refuse",
        message: "unused optional peer dependency react",
        file: "package.json",
      },
    ]);
  });

  it("does not count what is not unused: missing dependencies, binaries and unresolved imports", () => {
    const text = report([
      issue("a.ts", {
        unlisted: [{ name: "x" }],
        binaries: [{ name: "y" }],
        unresolved: [{ name: "z" }],
      }),
    ]);
    expect(readKnip(text)).toEqual([]);
  });

  it("names an item with no name, and a file with none, `?`", () => {
    expect(readKnip(report([{ exports: [{}] }]))).toEqual([
      {
        tool: "knip",
        rule: "knip:exports",
        verdict: "refuse",
        message: "unused export ?",
        file: "?",
      },
    ]);
  });

  it("reads a clean report as no finding", () => {
    expect(readKnip(report([]))).toEqual([]);
  });

  it.each(["", "not json", "[]", "{}", '{"issues":"x"}'])("is undefined for %j", (text) => {
    expect(readKnip(text)).toBeUndefined();
  });
});

describe("runKnip", () => {
  const input = (item: Prepared, exec: Exec) => {
    const base = inputFor([LAW], { cwd: item.project.dir });
    return { ...base, ctx: { ...base.ctx, outDir: item.outDir, exec } };
  };

  it("runs knip with the JSON reporter, and reads what it printed on exit 1", async () => {
    const item = setup();
    const fake = fakeExec(item.project.dir, {
      knip: () => ({
        code: 1,
        stdout: report([issue("unused.ts", { files: [{ name: "unused.ts" }] })]),
        stderr: "",
      }),
    });
    const done = await runKnip(input(item, fake.exec));
    expect(fake.calls).toEqual([{ tool: "knip", args: ["--reporter", "json"] }]);
    expect(done).toMatchObject({ findings: [{ rule: "knip:files" }] });
  });

  it.each([
    [
      "exits with an error",
      { code: 2, stdout: "", stderr: "bad config\n" },
      "knip exited 2 and gave no report: bad config",
    ],
    [
      "prints no report",
      { code: 0, stdout: "hello", stderr: "" },
      "knip exited 0 and gave no report: hello",
    ],
  ])("gives no answer when knip %s", async (_name, result, reason) => {
    const item = setup();
    const fake = fakeExec(item.project.dir, { knip: () => result });
    expect(await runKnip(input(item, fake.exec))).toEqual({ reason });
  });
});

describe("knipReader with knip not installed", () => {
  it("is not evaluated, and says knip is not installed", async () => {
    const item = setup({}, { without: ["knip"] });
    const base = inputFor([LAW], { cwd: item.project.dir });
    const readings = await knipReader(base);
    expect(readings[0]).toMatchObject({ law: "W-48", verdict: "not-evaluated" });
    expect(readings[0]?.reason).toBe(
      "knip exited null and gave no report: knip is not installed in node_modules (package knip)",
    );
  });
});

describe("knipReader over what knip said", () => {
  it("refuses a law over the issues knip lists, even under a ratchet: gate 1 counts no knip finding", async () => {
    const item = setup();
    const fake = fakeExec(item.project.dir, {
      knip: () => ({
        code: 1,
        stdout: report([issue("unused.ts", { files: [{ name: "unused.ts" }] })]),
        stderr: "",
      }),
    });
    const base = inputFor([LAW], { cwd: item.project.dir, held: true });
    const readings = await knipReader({
      ...base,
      ctx: { ...base.ctx, outDir: item.outDir, exec: fake.exec },
    });
    expect(readings[0]).toMatchObject({ law: "W-48", verdict: "refuse" });
    expect(readings[0]?.findings).toHaveLength(1);
  });
});
