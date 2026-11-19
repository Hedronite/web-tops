import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cfg, noExec } from "../../gate/testkit.ts";
import type { ExecResult, LayerContext } from "../../gate/types.ts";
import { install } from "./build.ts";
import { packageExports } from "./package.ts";
import { recorded } from "./testkit.ts";
import type { PackageInfo, StepContext } from "./tooling.ts";

// The hygiene steps keep what bun install, publint and attw said, as run artifacts the laws layer reads
// (W-40 and W-18); the findings and the verdict of each step are as they were.

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

type Script = (tool: string, args: readonly string[], dir: string) => ExecResult;

interface Run {
  readonly step: StepContext;
  readonly dir: string;
  readonly calls: (readonly [string, readonly string[]])[];
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

function stepOf(
  script: Script,
  pkg: PackageInfo = { name: "pkg", version: "1.0.0", exportsText: "" },
): Run {
  const dir = mkdtempSync(join(tmpdir(), "wt-step-"));
  roots.push(dir);
  const calls: (readonly [string, readonly string[]])[] = [];
  const step: StepContext = {
    ctx: layerContext(dir),
    settings: cfg().hygiene,
    run: (tool, args) => {
      calls.push([tool, args]);
      return Promise.resolve(script(tool, args, dir));
    },
    dir,
    out: (name) => join(dir, name),
    pkg,
  };
  return { step, dir, calls };
}

const result = (code: number | null, stdout = "", stderr = ""): ExecResult => ({
  code,
  stdout,
  stderr,
});

const json = (path: string | undefined): unknown =>
  path === undefined ? undefined : JSON.parse(readFileSync(path, "utf8"));

describe("install: install-json", () => {
  it("keeps the exit code of a frozen install that passed, and reports nothing", async () => {
    const run = stepOf(() => result(0));
    const outcome = await install(run.step);
    expect(run.calls).toEqual([["bun", ["install", "--frozen-lockfile"]]]);
    expect(outcome.findings).toEqual([]);
    expect(outcome.artifacts).toEqual({ "install-json": join(run.dir, "install.json") });
    expect(json(outcome.artifacts?.["install-json"])).toEqual({
      command: "bun install --frozen-lockfile",
      code: 0,
    });
  });

  it("keeps a failing exit code, and fails the step as before", async () => {
    const run = stepOf(() => result(1, "", "lockfile had changes, but lockfile is frozen\n"));
    const outcome = await install(run.step);
    expect(outcome.findings).toEqual([
      {
        tool: "bun",
        rule: "install-failed",
        verdict: "fail",
        message:
          "bun install --frozen-lockfile exited 1: lockfile had changes, but lockfile is frozen",
      },
    ]);
    expect(json(outcome.artifacts?.["install-json"])).toEqual({
      command: "bun install --frozen-lockfile",
      code: 1,
    });
  });

  it("keeps nothing when bun could not run, so a missing file means no answer", async () => {
    const run = stepOf(() => ({ code: null, stdout: "", stderr: "", failure: "tool-timeout" }));
    const outcome = await install(run.step);
    expect(outcome.artifacts).toBeUndefined();
    expect(existsSync(join(run.dir, "install.json"))).toBe(false);
    expect(outcome.findings).toEqual([
      {
        tool: "bun",
        rule: "tool-timeout",
        verdict: "fail",
        message: "bun did not finish in time and was killed",
      },
    ]);
  });
});

/** A bun that packs into the directory it is told, publint and attw as scripted. */
function packing(publint: ExecResult, attw: ExecResult): Script {
  return (tool, _args, dir) => {
    if (tool === "bun") {
      writeFileSync(join(dir, "pkg-1.0.0.tgz"), "tarball");
      return result(0);
    }
    return tool === "publint" ? publint : attw;
  };
}

const profile = (esm: boolean) => ({
  tool: "attw",
  rule: "attw-profile",
  verdict: "pass",
  message: esm
    ? "attw ran with --profile esm-only: type module and no require condition in exports"
    : "attw ran with its default profile",
});

describe("packageExports: publint-json and attw-json", () => {
  it("keeps a clean run of each tool as an empty report, and calls them as it did", async () => {
    const run = stepOf(packing(result(0), result(0)));
    const outcome = await packageExports(run.step);
    expect(run.calls).toEqual([
      ["bun", ["pm", "pack", "--destination", run.dir]],
      ["publint", ["run", join(run.dir, "pkg-1.0.0.tgz")]],
      ["attw", [join(run.dir, "pkg-1.0.0.tgz"), "--format", "json"]],
    ]);
    expect(outcome.findings).toEqual([profile(false)]);
    expect(outcome.artifacts).toEqual({
      "publint-json": join(run.dir, "publint.json"),
      "attw-json": join(run.dir, "attw.json"),
    });
    expect(json(outcome.artifacts?.["publint-json"])).toEqual({ code: 0, errors: [] });
    expect(json(outcome.artifacts?.["attw-json"])).toEqual({ code: 0, problems: [] });
  });

  it("runs attw with the esm-only profile for a module package that names no require condition", async () => {
    const run = stepOf(packing(result(0), result(0)), {
      name: "pkg",
      version: "1.0.0",
      type: "module",
      exportsText: '{".":"./dist/index.js"}',
    });
    const outcome = await packageExports(run.step);
    expect(run.calls[2]?.[1]).toEqual([
      join(run.dir, "pkg-1.0.0.tgz"),
      "--format",
      "json",
      "--profile",
      "esm-only",
    ]);
    expect(outcome.findings).toEqual([profile(true)]);
  });

  it("keeps the errors publint listed, one finding each as before", async () => {
    const run = stepOf(packing(result(1, recorded("publint-dual-broken.txt")), result(0)));
    const outcome = await packageExports(run.step);
    const errors = [
      'pkg.exports["."].require.types is ./dist/index.d.cts but the file does not exist.',
      'pkg.exports["."].require.default is ./dist/index.cjs but the file does not exist.',
    ];
    expect(json(outcome.artifacts?.["publint-json"])).toEqual({ code: 1, errors });
    expect(outcome.findings.slice(2)).toEqual([profile(false)]);
    expect(outcome.findings.slice(0, 2).map((finding) => finding.message)).toEqual(errors);
    expect(outcome.findings.slice(0, 2).every((finding) => finding.rule === "publint")).toBe(true);
  });

  it("keeps a publint that failed with no error listed as a report with none, and fails the step as before", async () => {
    const run = stepOf(packing(result(2, "something odd\n"), result(0)));
    const outcome = await packageExports(run.step);
    expect(json(outcome.artifacts?.["publint-json"])).toEqual({ code: 2, errors: [] });
    expect(outcome.findings[0]).toEqual({
      tool: "publint",
      rule: "publint",
      verdict: "fail",
      message: "publint exited 2: something odd",
    });
  });

  it("keeps each problem attw named with its kind and entry point", async () => {
    const run = stepOf(packing(result(0), result(1, recorded("attw-dual-broken-plain.json"))));
    const outcome = await packageExports(run.step);
    expect(json(outcome.artifacts?.["attw-json"])).toEqual({
      code: 1,
      problems: [
        { kind: "NoResolution", entrypoint: "." },
        { kind: "NoResolution", entrypoint: "." },
      ],
    });
    expect(outcome.findings.slice(1)).toEqual([
      {
        tool: "attw",
        rule: "attw:NoResolution",
        verdict: "fail",
        message: "entrypoint .",
      },
      {
        tool: "attw",
        rule: "attw:NoResolution",
        verdict: "fail",
        message: "entrypoint .",
      },
    ]);
  });

  it("names the entry point `?` for a problem that gives none", async () => {
    const attw = result(
      1,
      JSON.stringify({ problems: { FalseCJS: [{ kind: "FalseCJS" }, "odd"] } }),
    );
    const outcome = await packageExports(stepOf(packing(result(0), attw)).step);
    expect(json(outcome.artifacts?.["attw-json"])).toEqual({
      code: 1,
      problems: [
        { kind: "FalseCJS", entrypoint: "?" },
        { kind: "FalseCJS", entrypoint: "?" },
      ],
    });
  });

  it("keeps an attw that printed no JSON as a report with no problem, and fails the step as before", async () => {
    const run = stepOf(packing(result(0), result(1, "not json", "boom\n")));
    const outcome = await packageExports(run.step);
    expect(json(outcome.artifacts?.["attw-json"])).toEqual({ code: 1, problems: [] });
    expect(outcome.findings[1]).toEqual({
      tool: "attw",
      rule: "attw-failed",
      verdict: "fail",
      message: "attw exited 1: boom",
    });
  });

  it("fails with no listed problem when attw exits non-zero with JSON that lists none", async () => {
    const run = stepOf(packing(result(0), result(3, "{}")));
    const outcome = await packageExports(run.step);
    expect(outcome.findings[1]).toEqual({
      tool: "attw",
      rule: "attw-failed",
      verdict: "fail",
      message: "attw exited 3 with no listed problems",
    });
    expect(json(outcome.artifacts?.["attw-json"])).toEqual({ code: 3, problems: [] });
  });

  it("keeps no report for a tool that could not run, and still keeps the other's", async () => {
    const gone: Script = (tool, args, dir) =>
      tool === "publint"
        ? { code: null, stdout: "", stderr: "", failure: "tool-missing" }
        : packing(result(0), result(0))(tool, args, dir);
    const outcome = await packageExports(stepOf(gone).step);
    expect(Object.keys(outcome.artifacts ?? {})).toEqual(["attw-json"]);
    expect(outcome.findings.map((finding) => finding.rule)).toEqual([
      "tool-missing",
      "attw-profile",
    ]);
  });

  it("keeps nothing and says why when the pack failed", async () => {
    const run = stepOf((tool) => (tool === "bun" ? result(1, "", "no package.json\n") : result(0)));
    const outcome = await packageExports(run.step);
    expect(outcome.artifacts).toBeUndefined();
    expect(outcome.findings).toEqual([
      {
        tool: "bun",
        rule: "pack-failed",
        verdict: "fail",
        message: "bun pm pack exited 1 and left no tarball: no package.json",
      },
    ]);
  });

  it("fails the pack when bun exits 0 and leaves no tarball", async () => {
    const run = stepOf(() => result(0));
    const outcome = await packageExports(run.step);
    expect(outcome.findings[0]?.message).toContain("bun pm pack exited 0 and left no tarball");
  });
});
