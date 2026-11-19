import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cfg, noExec } from "../../gate/testkit.ts";
import type { ExecResult, LayerContext } from "../../gate/types.ts";
import { tsc } from "./build.ts";
import { hygieneLayer } from "./index.ts";
import { recorded } from "./testkit.ts";
import type { StepContext } from "./tooling.ts";

// The hygiene tsc step keeps every diagnostic of `tsc -b --noEmit` in a run artifact that the laws
// layer reads; what the step reports as findings, and so the layer's verdict, is unchanged by it.

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface Outcome {
  readonly findings: readonly unknown[];
  readonly artifacts: Readonly<Record<string, string>> | undefined;
  readonly path: string;
  readonly written: unknown;
}

function layerContext(dir: string): LayerContext {
  return {
    cwd: dir,
    config: cfg(),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: noExec,
    outDir: dir,
    artifacts: new Map(),
  };
}

async function runTsc(result: ExecResult): Promise<Outcome> {
  const dir = mkdtempSync(join(tmpdir(), "wt-tsc-"));
  roots.push(dir);
  const calls: (readonly [string, readonly string[]])[] = [];
  const step: StepContext = {
    ctx: layerContext(dir),
    settings: cfg().hygiene,
    run: (tool, args) => {
      calls.push([tool, args]);
      return Promise.resolve(result);
    },
    dir,
    out: (name) => join(dir, name),
    pkg: { name: "", version: "", exportsText: "" },
  };
  const outcome = await tsc(step);
  expect(calls).toEqual([["tsc", ["-b", "--noEmit"]]]);
  const path = join(dir, "tsc-diagnostics.json");
  const written: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  return { findings: outcome.findings, artifacts: outcome.artifacts, path, written };
}

const exited = (code: number, stdout: string): ExecResult => ({ code, stdout, stderr: "" });

describe("R87 hygiene tsc: tsc-diagnostics.json", () => {
  it("is declared by the hygiene layer, whose other declarations are as they were", () => {
    expect(hygieneLayer.produces).toEqual([
      "audit-json",
      "eslint-json",
      "stylelint-json",
      "dependency-cruiser-json",
      "tsc-diagnostics",
    ]);
    expect(hygieneLayer.classes).toEqual([
      "ts-library",
      "ui-components",
      "astro-site",
      "web-app",
      "node-service",
    ]);
    expect(hygieneLayer.requires).toEqual([]);
    expect(hygieneLayer.consumes).toEqual([]);
  });

  it("holds an empty array when the compile was clean, and names the file as the artifact", async () => {
    const { findings, artifacts, path, written } = await runTsc(exited(0, ""));
    expect(written).toEqual([]);
    expect(artifacts).toEqual({ "tsc-diagnostics": path });
    expect(findings).toEqual([]);
  });

  it("holds an empty array on exit 0 whatever the output says", async () => {
    const { written, findings } = await runTsc(
      exited(0, "src/a.ts(1,2): error TS1005: ';' expected.\n"),
    );
    expect(written).toEqual([]);
    expect(findings).toEqual([]);
  });

  it("holds one entry per diagnostic, and reports a finding for each exactly as before", async () => {
    const { findings, written } = await runTsc(exited(1, recorded("tsc-errors.txt")));
    expect(written).toEqual([
      {
        file: "src/z.ts",
        line: 1,
        column: 14,
        code: "TS2322",
        message: "Type 'string' is not assignable to type 'number'.",
      },
      {
        file: "src/z.ts",
        line: 2,
        column: 14,
        code: "TS2322",
        message: "Type 'number' is not assignable to type 'string'.",
      },
    ]);
    expect(findings).toEqual([
      {
        tool: "tsc",
        rule: "TS2322",
        verdict: "fail",
        message: "Type 'string' is not assignable to type 'number'.",
        file: "src/z.ts",
        line: 1,
      },
      {
        tool: "tsc",
        rule: "TS2322",
        verdict: "fail",
        message: "Type 'number' is not assignable to type 'string'.",
        file: "src/z.ts",
        line: 2,
      },
    ]);
  });

  it("reads a line and a column of more than one digit", async () => {
    const { written } = await runTsc(exited(1, "src/a.ts(120,345): error TS2345: Wrong.\n"));
    expect(written).toEqual([
      { file: "src/a.ts", line: 120, column: 345, code: "TS2345", message: "Wrong." },
    ]);
  });

  it("gives a diagnostic with no file null file, line and column, and fails the step as it did", async () => {
    const stdout = "error TS5058: The specified path does not exist: 'src/missing'.\n";
    const { findings, written } = await runTsc(exited(1, stdout));
    expect(written).toEqual([
      {
        file: null,
        line: null,
        column: null,
        code: "TS5058",
        message: "The specified path does not exist: 'src/missing'.",
      },
    ]);
    expect(findings).toEqual([
      {
        tool: "tsc",
        rule: "tsc-failed",
        verdict: "fail",
        message: `tsc exited 1: ${stdout.trim()}`,
      },
    ]);
  });

  it("keeps a file-less diagnostic beside the others, in order, and reports only the ones with a file", async () => {
    const stdout = [
      "error TS5058: The specified path does not exist: 'src/missing'.",
      "src/a.ts(3,7): error TS7006: Parameter 'x' implicitly has an 'any' type.",
      "",
    ].join("\n");
    const { findings, written } = await runTsc(exited(1, stdout));
    expect(written).toEqual([
      expect.objectContaining({ file: null, code: "TS5058" }),
      expect.objectContaining({ file: "src/a.ts", line: 3, column: 7, code: "TS7006" }),
    ]);
    expect(findings).toEqual([expect.objectContaining({ rule: "TS7006", file: "src/a.ts" })]);
  });

  it("keeps the first line of a message, not the lines that continue it", async () => {
    const stdout = "src/a.ts(3,7): error TS2345: Argument is wrong.\n  Type 'a' is not 'b'.\n";
    const { written } = await runTsc(exited(1, stdout));
    expect(written).toEqual([
      { file: "src/a.ts", line: 3, column: 7, code: "TS2345", message: "Argument is wrong." },
    ]);
  });

  it("does not read a diagnostic out of the middle of a line", async () => {
    const { written, artifacts } = await runTsc(
      exited(1, "a note quoting error TS2322: nothing\n"),
    );
    expect(written).toBeUndefined();
    expect(artifacts).toEqual({});
  });

  it("writes a project-relative path with forward slashes", async () => {
    const { written } = await runTsc(exited(1, "src\\deep\\a.ts(3,7): error TS2345: Wrong.\n"));
    expect(written).toEqual([
      { file: "src/deep/a.ts", line: 3, column: 7, code: "TS2345", message: "Wrong." },
    ]);
  });

  it("writes nothing when tsc failed with no diagnostic to read, so a missing file means no answer", async () => {
    const { findings, written, artifacts } = await runTsc({
      code: 2,
      stdout: "something went wrong\n",
      stderr: "",
    });
    expect(written).toBeUndefined();
    expect(artifacts).toEqual({});
    expect(findings).toEqual([
      {
        tool: "tsc",
        rule: "tsc-failed",
        verdict: "fail",
        message: "tsc exited 2: something went wrong",
      },
    ]);
  });

  it.each([
    ["tool-missing", " tsc is gone \n", "tool-missing", "tsc is gone"],
    ["tool-missing", "", "tool-missing", "tsc is not installed or not on PATH"],
    ["tool-timeout", "", "tool-timeout", "tsc did not finish in time and was killed"],
  ] as const)(
    "writes nothing when tsc could not run (%s)",
    async (failure, stderr, rule, message) => {
      const { findings, written, artifacts } = await runTsc({
        code: null,
        stdout: "",
        stderr,
        failure,
      });
      expect(written).toBeUndefined();
      expect(artifacts).toBeUndefined();
      expect(findings).toEqual([{ tool: "tsc", rule, verdict: "fail", message }]);
    },
  );
});
