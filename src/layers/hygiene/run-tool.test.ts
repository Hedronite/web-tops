import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Files from "../../acks/files.ts";
import type { AckedFiles } from "../../acks/files.ts";
import { cfg, tempProject, type TempProject } from "../../gate/testkit.ts";
import type { Exec, ExecOptions, ExecResult, GateConfig, LayerContext } from "../../gate/types.ts";
import { ackedEnv, readLedger, runTool, toolEnv, toolOf } from "./tooling.ts";

const seen: { args: unknown[][] } = vi.hoisted(() => ({ args: [] }));

vi.mock("../../acks/files.ts", async (original) => ({
  ...(await original<typeof Files>()),
  ackedFiles: (...args: unknown[]): AckedFiles => {
    seen.args.push(args);
    return { ok: true, files: ["src/page.astro"] };
  },
}));

const SEVERITY = (): "A" => "A";
vi.mock("../../acks/severity.ts", () => ({ catalogSeverity: () => SEVERITY }));

/** Running tools and the ack ledger's files: what environment each tool gets, and what runs for a name. */

const projects: TempProject[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    project.cleanup();
  }
});

const LISTED: AckedFiles = { ok: true, files: ["src/a.astro", "src/b.astro"] };
const UNREADABLE: AckedFiles = {
  ok: false,
  rule: "ack-ledger-unreadable",
  file: ".web-tops/acks.yaml",
  message: "the ledger is not YAML",
};
const CLEAN: ExecResult = { code: 0, stdout: "", stderr: "" };

interface Start {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: ExecOptions | undefined;
}

/** A context over a project, whose process runner records what it was asked to start and answers `answer`. */
function contextOver(
  dir: string,
  answer: ExecResult = CLEAN,
  env: LayerContext["env"] = { PATH: "/usr/bin" },
  config: GateConfig = cfg(),
): { ctx: LayerContext; starts: Start[] } {
  const starts: Start[] = [];
  const exec: Exec = (command, args, options) => {
    starts.push({ command, args, options });
    return Promise.resolve(answer);
  };
  const ctx: LayerContext = {
    cwd: dir,
    config,
    base: "origin/main",
    enforce: "hard",
    env,
    exec,
    outDir: join(dir, ".web-tops", "out"),
    artifacts: new Map(),
  };
  return { ctx, starts };
}

/** A project with each package installed, its `bin` the command it is run by. */
function installed(packages: readonly (readonly [string, string])[]): string {
  const { dir } = tempProject();
  for (const [name, command] of packages) {
    const root = join(dir, "node_modules", name);
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name, bin: { [command]: `bin/${command}.js` } }),
    );
    writeFileSync(join(root, "bin", `${command}.js`), "");
  }
  return dir;
}

describe("the finding's tool for a name a step runs", () => {
  it.each([
    ["astro", "astro"],
    ["attw", "attw"],
    ["biome", "biome"],
    ["bun", "bun"],
    ["bun audit", "audit"],
    ["bun pm pack", "bun"],
    ["dependency-cruiser", "dependency-cruiser"],
    ["depcruise", "dependency-cruiser"],
    ["eslint", "eslint"],
    ["prettier", "prettier"],
    ["publint", "publint"],
    ["stryker", "stryker"],
    ["stylelint", "stylelint"],
    ["tsc", "tsc"],
    ["something else", "webtops"],
  ])("names %s as %s", (name, tool) => {
    expect(toolOf(name)).toBe(tool);
  });
});

const LAW = (files: readonly string[]): string => JSON.stringify({ "W-28": files });

describe("the environment that tells the preset which files the ledger covers", () => {
  it("lists the files of a ledger that has some, by law", () => {
    expect(ackedEnv(LISTED)).toEqual({ WEBTOPS_ACKED_FILES: LAW(["src/a.astro", "src/b.astro"]) });
  });

  it("lists no file for a ledger that lists none, or cannot be read, so the finding stays", () => {
    expect(ackedEnv({ ok: true, files: [] })).toEqual({ WEBTOPS_ACKED_FILES: LAW([]) });
    expect(ackedEnv(UNREADABLE)).toEqual({ WEBTOPS_ACKED_FILES: LAW([]) });
  });
});

describe("the ledger's files for W-28", () => {
  it("asks for W-28 in the project, on today's UTC date, with the catalog's severities", () => {
    seen.args.length = 0;
    const { ctx } = contextOver("/work/site");
    const before = new Date().toISOString().slice(0, 10);
    const found = readLedger(ctx);
    const after = new Date().toISOString().slice(0, 10);
    expect(found).toEqual({ ok: true, files: ["src/page.astro"] });
    expect(seen.args).toHaveLength(1);
    const [cwd, law, today, severity] = seen.args[0] ?? [];
    expect([cwd, law]).toEqual(["/work/site", "W-28"]);
    expect([before, after]).toContain(today);
    expect(severity).toBe(SEVERITY);
  });
});

describe("the environment a tool runs in", () => {
  it("gives ESLint the ledger's files besides the layer's environment, asking about the run's context", () => {
    const { ctx } = contextOver("/work/site");
    const asked: LayerContext[] = [];
    const env = toolEnv(ctx, "eslint", (from) => {
      asked.push(from);
      return LISTED;
    });
    expect(asked).toEqual([ctx]);
    expect(env).toEqual({
      PATH: "/usr/bin",
      WEBTOPS_ACKED_FILES: LAW(["src/a.astro", "src/b.astro"]),
    });
  });

  it.each([
    ["lists none", { ok: true, files: [] } satisfies AckedFiles],
    ["cannot be read", UNREADABLE],
  ])("gives ESLint no file, over one the process inherited, when the ledger %s", (_name, acked) => {
    const inherited = { PATH: "/usr/bin", WEBTOPS_ACKED_FILES: LAW(["src/page.astro"]) };
    const { ctx } = contextOver("/work/site", CLEAN, inherited);
    expect(toolEnv(ctx, "eslint", () => acked)).toEqual({
      PATH: "/usr/bin",
      WEBTOPS_ACKED_FILES: LAW([]),
    });
  });

  it("gives every other tool the layer's environment, and never reads the ledger for it", () => {
    const { ctx } = contextOver("/work/site");
    const ledger = vi.fn(() => LISTED);
    expect(toolEnv(ctx, "tsc", ledger)).toEqual({ PATH: "/usr/bin" });
    expect(ledger).not.toHaveBeenCalled();
  });
});

describe("running a tool", () => {
  it("starts an installed tool under node with the project's directory, and gives ESLint the ledger's files", async () => {
    const dir = installed([["eslint", "eslint"]]);
    const { ctx, starts } = contextOver(dir);
    await runTool(ctx, "eslint", ["--format", "json"]);
    expect(starts).toEqual([
      {
        command: "node",
        args: [join(dir, "node_modules", "eslint", "bin", "eslint.js"), "--format", "json"],
        options: {
          cwd: dir,
          env: { PATH: "/usr/bin", WEBTOPS_ACKED_FILES: LAW(["src/page.astro"]) },
        },
      },
    ]);
  });

  it("gives another installed tool the layer's environment and the time it may take", async () => {
    const dir = installed([["typescript", "tsc"]]);
    const { ctx, starts } = contextOver(dir);
    await runTool(ctx, "tsc", ["--noEmit"], 5000);
    expect(starts[0]?.options).toEqual({ cwd: dir, env: { PATH: "/usr/bin" }, timeoutMs: 5000 });
  });

  it("starts a command that is not one of the tools as it is, from PATH", async () => {
    const { ctx, starts } = contextOver("/work/site");
    await runTool(ctx, "bun", ["install"]);
    expect(starts).toEqual([
      {
        command: "bun",
        args: ["install"],
        options: { cwd: "/work/site", env: { PATH: "/usr/bin" } },
      },
    ]);
  });

  it("starts nothing for a tool that is not installed, and says which package is missing", async () => {
    const { ctx, starts } = contextOver(installed([]));
    expect(await runTool(ctx, "tsc", [])).toEqual({
      code: null,
      stdout: "",
      stderr: "tsc is not installed in node_modules (package typescript)",
      failure: "tool-missing",
    });
    expect(starts).toEqual([]);
  });

  it("says node is not on PATH when it could not be started, and not that the tool is missing", async () => {
    const dir = installed([["typescript", "tsc"]]);
    const missing: ExecResult = { code: null, stdout: "", stderr: "", failure: "tool-missing" };
    const { ctx } = contextOver(dir, missing);
    expect(await runTool(ctx, "tsc", [])).toEqual({
      ...missing,
      stderr: "node is not on PATH, so tsc cannot run",
    });
  });
});
