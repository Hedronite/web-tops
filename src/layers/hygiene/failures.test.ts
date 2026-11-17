import { writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { off } from "../../gate/testkit.ts";
import { realExec } from "../../gate/exec.ts";
import { HYGIENE_STEPS, type Exec } from "../../gate/types.ts";
import {
  failures,
  fakeExec,
  prepare,
  recorded,
  REPO_ROOT,
  runHygiene,
  type Handler,
  type Prepared,
} from "./testkit.ts";

const prepared: Prepared[] = [];

afterEach(() => {
  for (const item of prepared.splice(0)) {
    item.project.cleanup();
  }
});

function setup(files: Record<string, string> = {}, without: readonly string[] = []): Prepared {
  const item = prepare(files, { without });
  prepared.push(item);
  return item;
}

const PACKAGE = JSON.stringify({
  name: "pkg",
  version: "1.0.0",
  type: "module",
  exports: { ".": "./dist/index.js" },
});
const MISSING: Handler = () => ({ code: null, stdout: "", stderr: "", failure: "tool-missing" });
const TIMEOUT: Handler = () => ({ code: null, stdout: "", stderr: "", failure: "tool-timeout" });

function outputOf(args: readonly string[]): string {
  return args[args.indexOf("--output-file") + 1] ?? "";
}

describe("G3c hygiene: a missing tool fails, an empty output fails, class-only tools skip with a reason", () => {
  it.each([
    ["tsc", "typescript"],
    ["eslint", "eslint"],
    ["prettier", "prettier"],
    ["depcruise", "dependency-cruiser"],
    ["publint", "publint"],
    ["attw", "@arethetypeswrong/cli"],
  ])(
    "%s that is not in node_modules is a tool-missing Refuse naming its package, and is never started",
    async (tool, installed) => {
      const item = setup({ "package.json": PACKAGE }, [tool]);
      const fake = fakeExec(item.project.dir);
      const result = await runHygiene(item, fake.exec);
      expect(result.verdict).toBe("Refuse");
      const finding = result.findings.find((entry) => entry.rule === "tool-missing");
      expect(finding?.message).toBe(
        `${tool} is not installed in node_modules (package ${installed})`,
      );
      expect(fake.count(tool)).toBe(0);
      expect(fake.calls.map((call) => call.tool)).not.toContain("node");
    },
  );

  it.each([
    ["bun install", "bun"],
    ["bun audit", "bun audit"],
    ["bun pm", "bun pm pack"],
  ])(
    "a missing runtime (%s) is a tool-missing Refuse that says it is not on PATH",
    async (key, name) => {
      const item = setup({ "package.json": PACKAGE });
      const fake = fakeExec(item.project.dir, { [key]: MISSING });
      const result = await runHygiene(item, fake.exec);
      expect(result.verdict).toBe("Refuse");
      const finding = result.findings.find((entry) => entry.rule === "tool-missing");
      expect(finding?.message).toBe(`${name} is not installed or not on PATH`);
    },
  );

  it("a tool on PATH does not stand in for one missing from node_modules", async () => {
    const item = setup({ "package.json": PACKAGE, "tsconfig.json": "{}" }, ["tsc"]);
    const onPath = `${join(REPO_ROOT, "node_modules", ".bin")}${delimiter}${process.env["PATH"] ?? ""}`;
    const result = await runHygiene(item, realExec, {
      env: { PATH: onPath },
      steps: Object.fromEntries(
        HYGIENE_STEPS.filter((step) => step !== "tsc").map((step) => [step, off("not under test")]),
      ),
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule: "tool-missing",
        message: "tsc is not installed in node_modules (package typescript)",
      }),
    );
  });

  it("a missing node is not blamed on the tool", async () => {
    const item = setup({ "package.json": PACKAGE });
    const gone: Handler = () => ({ code: null, stdout: "", stderr: "", failure: "tool-missing" });
    const exec: Exec = (command, args) =>
      command === "node"
        ? Promise.resolve(gone(args, item.project.dir))
        : fakeExec(item.project.dir).exec(command, args);
    const result = await runHygiene(item, exec);
    const finding = result.findings.find((entry) => entry.rule === "tool-missing");
    expect(finding?.message).toBe("node is not on PATH, so tsc cannot run");
  });

  it("with PATH stripped and no node_modules, the real process runner reports the tool missing", async () => {
    const item = setup({ "package.json": PACKAGE });
    const result = await runHygiene(item, realExec, { env: { PATH: "" } });
    expect(result.verdict).toBe("Refuse");
    expect(result.findings[0]).toMatchObject({ rule: "tool-missing" });
    expect(result.findings[0]?.message).toContain("bun");
  });

  it("a project with no lockfile makes bun audit print nothing on stdout: output-empty naming the lockfile, not a pass", async () => {
    const item = setup({ "package.json": PACKAGE });
    const handlers = {
      "bun audit": () => ({ code: 1, stdout: "", stderr: recorded("audit-no-lockfile.stderr") }),
    };
    const result = await runHygiene(item, fakeExec(item.project.dir, handlers).exec);
    expect(failures(result)).toEqual(["output-empty"]);
    expect(result.findings.find((finding) => finding.rule === "output-empty")?.message).toContain(
      "missing lockfile, nothing to audit",
    );
    expect(result.verdict).toBe("Refuse");
  });

  it("a tool that outlives its timeout is a tool-timeout Refuse", async () => {
    const item = setup({ "package.json": PACKAGE });
    const result = await runHygiene(item, fakeExec(item.project.dir, { tsc: TIMEOUT }).exec);
    expect(failures(result)).toEqual(["tool-timeout"]);
  });

  it.each([
    [
      "ESLint writes a 0-byte file",
      {
        eslint: (args: readonly string[]) => (
          writeFileSync(outputOf(args), ""),
          { code: 0, stdout: "", stderr: "" }
        ),
      },
    ],
    ["ESLint writes no file", { eslint: () => ({ code: 0, stdout: "", stderr: "" }) }],
    [
      "dependency-cruiser prints nothing",
      { depcruise: () => ({ code: 0, stdout: "", stderr: "" }) },
    ],
    ["bun audit prints nothing", { "bun audit": () => ({ code: 0, stdout: "", stderr: "" }) }],
  ] as const)("%s: output-empty", async (_label, handlers) => {
    const item = setup({ "package.json": PACKAGE });
    const result = await runHygiene(item, fakeExec(item.project.dir, handlers).exec);
    expect(failures(result)).toEqual(["output-empty"]);
    expect(result.verdict).toBe("Refuse");
  });

  it.each([
    [
      "ESLint writes text",
      {
        eslint: (args: readonly string[]) => (
          writeFileSync(outputOf(args), "not json"),
          { code: 1, stdout: "", stderr: "" }
        ),
      },
    ],
    [
      "dependency-cruiser prints text",
      { depcruise: () => ({ code: 1, stdout: "boom", stderr: "" }) },
    ],
    ["bun audit prints text", { "bun audit": () => ({ code: 1, stdout: "boom", stderr: "" }) }],
  ] as const)("%s: output-unparseable", async (_label, handlers) => {
    const item = setup({ "package.json": PACKAGE });
    const result = await runHygiene(item, fakeExec(item.project.dir, handlers).exec);
    expect(failures(result)).toEqual(["output-unparseable"]);
  });

  it("a registry that cannot be reached is not-evaluated, never a pass and never a Refuse", async () => {
    const item = setup({ "package.json": PACKAGE });
    const fake = fakeExec(item.project.dir, {
      "bun audit": () => ({ code: 1, stdout: "", stderr: recorded("audit-unreachable.stderr") }),
    });
    const result = await runHygiene(item, fake.exec);
    expect(result.verdict).toBe("not-evaluated");
    expect(failures(result)).toEqual(["audit-unreachable"]);
  });

  it("a clean {} audit result passes, and a crash with no output is its own finding", async () => {
    const item = setup({ "package.json": PACKAGE });
    const clean = await runHygiene(item, fakeExec(item.project.dir).exec);
    expect(clean.verdict).toBe("pass");
    const crash = await runHygiene(
      item,
      fakeExec(item.project.dir, { tsc: () => ({ code: 2, stdout: "", stderr: "oops" }) }).exec,
    );
    expect(failures(crash)).toEqual(["tsc-failed"]);
  });

  it("skips a switched-off step with the config's reason and does not run its tool", async () => {
    const item = setup({ "package.json": PACKAGE });
    const fake = fakeExec(item.project.dir);
    const result = await runHygiene(item, fake.exec, { steps: { audit: off("offline lab") } });
    expect(fake.count("bun audit")).toBe(0);
    expect(result.findings).toContainEqual({
      rule: "step:audit",
      verdict: "skip",
      message: "offline lab",
    });
    expect(result.verdict).toBe("pass");
  });

  it("skips the class-only steps with a reason that names the class", async () => {
    const item = setup();
    const result = await runHygiene(item, fakeExec(item.project.dir).exec, {
      className: "node-service",
    });
    const reasons = new Map(
      result.findings
        .filter((entry) => entry.verdict === "skip")
        .map((entry) => [entry.rule, entry.message]),
    );
    expect(reasons.get("step:astro_check")).toBe("class node-service does not map astro_check");
    expect(reasons.get("step:stylelint")).toBe("class node-service does not map stylelint");
    expect(reasons.get("step:package_exports")).toBe(
      "class node-service does not map package_exports",
    );
  });

  it("reads the one formatter config; none or both is a Refuse, and format.tool wins", async () => {
    const none = setup({ "package.json": PACKAGE });
    writeFileSync(`${none.project.dir}/prettier.config.js`, "");
    const bare = prepare({ "package.json": PACKAGE });
    prepared.push(bare);
    const rm = await import("node:fs").then((fs) => fs.rmSync);
    rm(`${bare.project.dir}/prettier.config.js`);
    const unset = await runHygiene(bare, fakeExec(bare.project.dir).exec);
    expect(failures(unset)).toEqual(["formatter-unset"]);
    const both = setup({ "package.json": PACKAGE, "biome.json": "{}" });
    const ambiguous = await runHygiene(both, fakeExec(both.project.dir).exec);
    expect(failures(ambiguous)).toEqual(["formatter-ambiguous"]);
    const biome = setup({ "package.json": PACKAGE, "biome.json": "{}" });
    const fake = fakeExec(biome.project.dir);
    const chosen = await runHygiene(biome, fake.exec, { settings: { formatTool: "biome" } });
    expect(chosen.verdict).toBe("pass");
    expect(fake.count("biome")).toBe(1);
    expect(fake.count("prettier")).toBe(0);
    const detected = prepare({ "package.json": PACKAGE, "biome.json": "{}" });
    prepared.push(detected);
    rm(`${detected.project.dir}/prettier.config.js`);
    const fake2 = fakeExec(detected.project.dir);
    await runHygiene(detected, fake2.exec);
    expect(fake2.count("biome")).toBe(1);
  });

  it("caps a long finding list and says how many it dropped", async () => {
    const item = setup({ "package.json": PACKAGE });
    const lines = Array.from(
      { length: 130 },
      (_, index) => `src/f${String(index)}.ts(1,1): error TS2322: bad`,
    ).join("\n");
    const result = await runHygiene(
      item,
      fakeExec(item.project.dir, { tsc: () => ({ code: 1, stdout: lines, stderr: "" }) }).exec,
    );
    expect(result.findings.filter((entry) => entry.rule === "TS2322")).toHaveLength(100);
    expect(
      result.findings.some((entry) => entry.message === "and 30 more findings, not listed"),
    ).toBe(true);
  });
});
