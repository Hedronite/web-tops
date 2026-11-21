import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AckedFiles } from "../../acks/files.ts";
import { cfg } from "../../gate/testkit.ts";
import type { Exec, LayerContext } from "../../gate/types.ts";
import { ackedEnv, eslintWith, readLedger, withEnv } from "./lint.ts";
import { fakeExec, prepare, type Prepared } from "./testkit.ts";
import type { StepContext } from "./tooling.ts";

const seen: { args: unknown[][] } = vi.hoisted(() => ({ args: [] }));

vi.mock("../../acks/files.ts", () => ({
  ackedFiles: (...args: unknown[]): AckedFiles => {
    seen.args.push(args);
    return { ok: true, files: ["src/page.astro"] };
  },
}));

const SEVERITY = (): "A" => "A";
vi.mock("../../acks/severity.ts", () => ({ catalogSeverity: () => SEVERITY }));

const prepared: Prepared[] = [];

afterEach(() => {
  for (const item of prepared.splice(0)) {
    item.project.cleanup();
  }
});

const LISTED: AckedFiles = { ok: true, files: ["src/a.astro", "src/b.astro"] };
const UNREADABLE: AckedFiles = {
  ok: false,
  rule: "ack-ledger-unreadable",
  file: ".web-tops/acks.yaml",
  message: "the ledger is not YAML",
};

/** A step over a project with fake tools, and every process the step starts, with the environment it was given. */
function stepOver(env: Readonly<Record<string, string | undefined>>): {
  step: StepContext;
  starts: { command: string; args: readonly string[]; env: unknown; cwd: unknown }[];
} {
  const item = prepare();
  prepared.push(item);
  const fake = fakeExec(item.project.dir);
  const starts: { command: string; args: readonly string[]; env: unknown; cwd: unknown }[] = [];
  const exec: Exec = (command, args, options) => {
    starts.push({ command, args, env: options?.env, cwd: options?.cwd });
    return fake.exec(command, args, options);
  };
  const ctx: LayerContext = {
    cwd: item.project.dir,
    config: cfg(),
    base: "origin/main",
    enforce: "hard",
    env,
    exec,
    outDir: item.outDir,
    artifacts: new Map(),
  };
  const step: StepContext = {
    ctx,
    settings: ctx.config.hygiene,
    run: () => Promise.reject(new Error("the step's own runner is not used")),
    dir: item.outDir,
    out: (name) => join(item.outDir, name),
    pkg: { name: "pkg", version: "1.0.0", exportsText: "" },
  };
  return { step, starts };
}

describe("the environment that tells the preset which files the ledger covers", () => {
  it("lists the files of a ledger that has some, by law", () => {
    expect(ackedEnv(LISTED)).toEqual({
      WEBTOPS_ACKED_FILES: JSON.stringify({ "W-28": ["src/a.astro", "src/b.astro"] }),
    });
  });

  it("adds nothing for a ledger that lists no file", () => {
    expect(ackedEnv({ ok: true, files: [] })).toEqual({});
  });

  it("adds nothing for a ledger that cannot be read, so the finding stays", () => {
    expect(ackedEnv(UNREADABLE)).toEqual({});
  });
});

describe("the ledger's files for W-28", () => {
  it("asks for W-28 in the project, on today's UTC date, with the catalog's severities", () => {
    seen.args.length = 0;
    const before = new Date().toISOString().slice(0, 10);
    const found = readLedger("/work/site");
    const after = new Date().toISOString().slice(0, 10);
    expect(found).toEqual({ ok: true, files: ["src/page.astro"] });
    expect(seen.args).toHaveLength(1);
    const [cwd, law, today, severity] = seen.args[0] ?? [];
    expect([cwd, law]).toEqual(["/work/site", "W-28"]);
    expect([before, after]).toContain(today);
    expect(severity).toBe(SEVERITY);
  });
});

describe("a step run with more environment", () => {
  it("starts the tool with the project's environment and the extra, and leaves the step's own alone", async () => {
    const { step, starts } = stepOver({ PATH: "/usr/bin" });
    const output = step.out("run.json");
    await withEnv(step, { WEBTOPS_ACKED_FILES: "{}" }).run("eslint", ["--output-file", output]);
    expect(starts).toEqual([
      {
        command: "node",
        args: [
          join(step.ctx.cwd, "node_modules", "eslint", "bin", "eslint.js"),
          "--output-file",
          output,
        ],
        env: { PATH: "/usr/bin", WEBTOPS_ACKED_FILES: "{}" },
        cwd: step.ctx.cwd,
      },
    ]);
    expect(step.ctx.env).toEqual({ PATH: "/usr/bin" });
  });
});

describe("the eslint step", () => {
  it("runs ESLint with the ledger's files in its environment, asking the ledger about the project", async () => {
    const { step, starts } = stepOver({ PATH: "/usr/bin" });
    const asked: string[] = [];
    const result = await eslintWith(step, (cwd) => {
      asked.push(cwd);
      return LISTED;
    });
    expect(asked).toEqual([step.ctx.cwd]);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.env).toEqual({
      PATH: "/usr/bin",
      WEBTOPS_ACKED_FILES: JSON.stringify({ "W-28": ["src/a.astro", "src/b.astro"] }),
    });
    expect(result.findings).toEqual([]);
    expect(result.artifacts).toEqual({ "eslint-json": step.out("eslint.json") });
  });

  it("runs ESLint with the project's environment alone when the ledger cannot be read", async () => {
    const { step, starts } = stepOver({ PATH: "/usr/bin" });
    await eslintWith(step, () => UNREADABLE);
    expect(starts[0]?.env).toEqual({ PATH: "/usr/bin" });
  });
});
