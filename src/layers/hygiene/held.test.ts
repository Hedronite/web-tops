import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_BASELINE, writeBaselineFile } from "../../baseline/test-support.ts";
import type { Baseline } from "../../baseline/types.ts";
import { fakeExec, prepare, runHygiene, type Prepared } from "./testkit.ts";

/** G9-4: under ratchet with a baseline, hygiene holds a counted finding at or under its baseline count (WEB_TOPS.md section 6.7). */

const PACKAGE = '{ "name": "fixture", "version": "1.0.0" }\n';

type Message = [file: string, rule: string | null];

function outputOf(args: readonly string[]): string {
  return args[args.indexOf("--output-file") + 1] ?? "";
}

/** An ESLint that finds `messages`, one `[file, rule]` each. */
function lint(messages: readonly Message[]) {
  return (args: readonly string[], dir: string) => {
    const files = [...new Set(messages.map(([file]) => file))];
    const results = files.map((file) => ({
      filePath: join(dir, file),
      messages: messages
        .filter(([name]) => name === file)
        .map(([, rule], index) => ({ ruleId: rule, message: "found", line: index + 1 })),
    }));
    writeFileSync(outputOf(args), JSON.stringify(results));
    return { code: messages.length > 0 ? 1 : 0, stdout: "", stderr: "" };
  };
}

const HELD: Baseline = {
  ...EMPTY_BASELINE,
  findings: { "no-var": { "src/a.ts": 2, "src/b.ts": 1 } },
};

function setup(baseline: Baseline | undefined): Prepared {
  const item = prepare({ "package.json": PACKAGE });
  if (baseline !== undefined) writeBaselineFile(item.project.dir, "baseline.json", baseline);
  return item;
}

function run(
  item: Prepared,
  messages: readonly Message[],
  enforce: "hard" | "ratchet" = "ratchet",
) {
  const exec = fakeExec(item.project.dir, { eslint: lint(messages) }).exec;
  return runHygiene(item, exec, { enforce, baselinePath: "baseline.json" });
}

const LEGACY: Message[] = [
  ["src/a.ts", "no-var"],
  ["src/a.ts", "no-var"],
  ["src/b.ts", "no-var"],
];

describe("G9-4: hygiene under a held ratchet", () => {
  it("fails under hard, and with no baseline yet, on the same findings: the first baseline is measured", async () => {
    expect((await run(setup(HELD), LEGACY, "hard")).verdict).toBe("fail");
    expect((await run(setup(undefined), LEGACY)).verdict).toBe("fail");
  });

  it("passes with every counted finding at its baseline count, and still reports each one", async () => {
    const result = await run(setup(HELD), LEGACY);
    expect(result.verdict).toBe("pass");
    const found = result.findings.filter((finding) => finding.rule === "no-var");
    expect(found).toHaveLength(3);
    expect(found.every((finding) => finding.verdict === "fail")).toBe(true);
    expect(result.findings.find((finding) => finding.rule === "ratchet-held")).toMatchObject({
      verdict: "pass",
      tool: "webtops",
      message: "3 findings held by the baseline; a count above it is the ratchet's to refuse",
    });
  });

  it("passes with fewer findings than the baseline holds, and with none", async () => {
    expect((await run(setup(HELD), LEGACY.slice(0, 2))).verdict).toBe("pass");
    const none = await run(setup(HELD), []);
    expect(none.verdict).toBe("pass");
    expect(none.findings.some((finding) => finding.rule === "ratchet-held")).toBe(false);
  });

  it("leaves a rise to the ratchet, which refuses it: this layer holds what it was given", async () => {
    const result = await run(setup(HELD), [...LEGACY, ["src/c.ts", "no-var"]]);
    expect(result.verdict).toBe("pass");
    expect(result.findings.filter((finding) => finding.verdict === "fail")).toHaveLength(4);
  });

  it("still fails a tool that exits with no findings: that is not a counted finding", async () => {
    const item = setup(HELD);
    const exec = fakeExec(item.project.dir, {
      eslint: () => ({ code: 2, stdout: "", stderr: "boom" }),
    }).exec;
    const result = await runHygiene(item, exec, {
      enforce: "ratchet",
      baselinePath: "baseline.json",
    });
    expect(result.verdict).toBe("fail");
    expect(result.findings.map((finding) => finding.rule)).toContain("eslint-failed");
  });

  it("still fails a tool that cannot run", async () => {
    const item = prepare({ "package.json": PACKAGE }, { without: ["eslint"] });
    writeBaselineFile(item.project.dir, "baseline.json", HELD);
    const exec = fakeExec(item.project.dir, {}).exec;
    const result = await runHygiene(item, exec, {
      enforce: "ratchet",
      baselinePath: "baseline.json",
    });
    expect(result.verdict).toBe("fail");
  });

  it("still fails a counted finding beside a failure that is not one", async () => {
    const item = setup(HELD);
    const exec = fakeExec(item.project.dir, {
      eslint: lint(LEGACY),
      tsc: () => ({ code: 2, stdout: "", stderr: "tsc blew up" }),
    }).exec;
    const result = await runHygiene(item, exec, {
      enforce: "ratchet",
      baselinePath: "baseline.json",
    });
    expect(result.verdict).toBe("fail");
  });
});
