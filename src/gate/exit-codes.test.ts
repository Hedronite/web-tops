import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gateCommand, type GateDeps, type LoadedConfig } from "./command.ts";
import {
  cfg,
  fakeBuiltins,
  fakeLayer,
  memoryIo,
  noExec,
  parseReport,
  tempProject,
  type TempProject,
} from "./testkit.ts";
import type { GateConfig, Layer } from "./types.ts";

const projects: TempProject[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    project.cleanup();
  }
});

interface Harness {
  readonly dir: string;
  readonly io: ReturnType<typeof memoryIo>;
  readonly go: (argv: string[]) => Promise<number>;
  readonly reportPath: string;
}

function harness(
  options: {
    readonly layers?: (config: GateConfig) => Layer[];
    readonly config?: LoadedConfig;
    readonly env?: Record<string, string | undefined>;
    readonly versions?: { bun?: string; node: string };
  } = {},
): Harness {
  const project = tempProject();
  projects.push(project);
  const io = memoryIo();
  const deps: GateDeps = {
    cwd: project.dir,
    env: options.env ?? {},
    exec: noExec,
    versions: options.versions ?? { bun: "1.4.4", node: "24.0.0" },
    loadConfig: () => Promise.resolve(options.config ?? { ok: true, config: cfg() }),
    layers: options.layers ?? (() => fakeBuiltins([])),
    now: () => 1000,
  };
  return {
    dir: project.dir,
    io,
    go: (argv) => gateCommand(argv, io, deps),
    reportPath: join(project.dir, ".web-tops", "report.json"),
  };
}

describe("G2c cli: --dry-run under CI=true exits 4; every §12 exit code", () => {
  it("exits 0 when every layer passes, and prints the text report", async () => {
    const h = harness();
    expect(await h.go([])).toBe(0);
    expect(h.io.stdout()).toContain("hygiene");
    expect(h.io.stdout()).toContain("gate passed");
    expect(h.io.stderr()).toBe("");
  });

  it("exits 1 when a layer fails", async () => {
    const h = harness({ layers: () => fakeBuiltins([], { tests: "Refuse" }) });
    expect(await h.go([])).toBe(1);
    expect(h.io.stdout()).toContain("gate failed");
  });

  it("exits 2 for an invalid config and prints the JSON-pointer paths on stderr", async () => {
    const h = harness({ config: { ok: false, errors: ["/gates/crap/cap: must be >= 1"] } });
    expect(await h.go([])).toBe(2);
    expect(h.io.stderr()).toContain("/gates/crap/cap: must be >= 1");
    expect(h.io.stdout()).toBe("");
    expect(existsSync(h.reportPath)).toBe(false);
  });

  it.each([
    [["--max-tier", "9"], "--max-tier"],
    [["--max-tier", "x"], "--max-tier"],
    [["--max-tier"], "--max-tier"],
    [["--only", "ghost"], 'unknown layer "ghost"'],
    [["--only"], "--only"],
    [["--base"], "--base"],
    [["--nope"], 'unknown option "--nope"'],
    [["extra"], 'unexpected argument "extra"'],
  ])("exits 2 for the usage error %j", async (argv, text) => {
    const h = harness();
    expect(await h.go(argv)).toBe(2);
    expect(h.io.stderr()).toContain(text);
  });

  it.each([
    [{ bun: "1.3.9", node: "24.0.0" }, "Bun 1.3.9 is below 1.4.0"],
    [{ node: "22.23.3" }, "Node 22.23.3 is below 22.23.4"],
  ])("exits 3 when the runtime is below the pin: %j", async (versions, text) => {
    const h = harness({ versions });
    expect(await h.go([])).toBe(3);
    expect(h.io.stderr()).toContain(text);
    expect(existsSync(h.reportPath)).toBe(false);
  });

  it.each(["true", "TRUE", "1", "yes"])(
    "exits 4 for --dry-run with CI=%s, before any other work",
    async (ci) => {
      const h = harness({ env: { CI: ci }, config: { ok: false, errors: ["/x: bad"] } });
      expect(await h.go(["--dry-run"])).toBe(4);
      expect(h.io.stderr()).toContain("--dry-run is refused when CI=true");
      expect(existsSync(h.reportPath)).toBe(false);
    },
  );

  it.each([undefined, "", "0", "false", "FALSE"])(
    "lets --dry-run through when CI is %j: it prints the plan, runs nothing and writes no report",
    async (ci) => {
      const calls: string[] = [];
      const h = harness({ env: { CI: ci }, layers: () => fakeBuiltins(calls) });
      expect(await h.go(["--dry-run"])).toBe(0);
      expect(calls).toEqual([]);
      expect(h.io.stdout()).toContain("dry run");
      expect(h.io.stdout()).toContain("would run");
      expect(existsSync(h.reportPath)).toBe(false);
    },
  );

  it("--json prints the report and nothing else on stdout, and the exit code does not change", async () => {
    const h = harness({ layers: () => fakeBuiltins([], { tests: "Refuse" }) });
    expect(await h.go(["--json"])).toBe(1);
    const parsed = parseReport(h.io.stdout());
    expect(parsed.exit_code).toBe(1);
    expect(parsed.layers.map((layer) => layer.id)).toContain("laws");
  });

  it("runs only the --only layer and keeps going under --keep-going", async () => {
    const calls: string[] = [];
    const h = harness({ layers: () => fakeBuiltins(calls, { hygiene: "Refuse" }) });
    expect(await h.go(["--keep-going"])).toBe(1);
    expect(calls).toHaveLength(7);
    calls.length = 0;
    expect(await h.go(["--only", "tests"])).toBe(0);
    expect(calls).toEqual(["tests"]);
  });

  it("accepts --flag=value forms", async () => {
    const calls: string[] = [];
    const h = harness({
      layers: () => [...fakeBuiltins(calls), fakeLayer({ id: "nightly", gate: 6, tier: 2, calls })],
    });
    expect(await h.go(["--max-tier=2", "--only=nightly", "--base=main"])).toBe(0);
    expect(calls).toEqual(["nightly"]);
  });

  it("wipes a stale report and stale artifacts when the run starts, then writes a fresh report", async () => {
    let reportAtLayerStart: boolean | undefined;
    let staleArtifactAtLayerStart: boolean | undefined;
    const dirRef: { dir?: string } = {};
    const h = harness({
      layers: () => [
        fakeLayer({
          id: "hygiene",
          onRun: () => {
            const dir = dirRef.dir ?? "";
            reportAtLayerStart = existsSync(join(dir, ".web-tops", "report.json"));
            staleArtifactAtLayerStart = existsSync(join(dir, ".web-tops", "out", "lcov.info"));
          },
        }),
      ],
    });
    dirRef.dir = h.dir;
    mkdirSync(join(h.dir, ".web-tops", "out"), { recursive: true });
    writeFileSync(join(h.dir, ".web-tops", "out", "lcov.info"), "stale\n");
    writeFileSync(h.reportPath, '{"stale":true}\n');
    expect(await h.go([])).toBe(0);
    expect(reportAtLayerStart).toBe(false);
    expect(staleArtifactAtLayerStart).toBe(false);
    expect(parseReport(readFileSync(h.reportPath, "utf8"))).toMatchObject({ passed: true });
  });

  it("leaves an existing report untouched when the run is refused or the config is invalid", async () => {
    const refused = harness({ env: { CI: "true" } });
    mkdirSync(join(refused.dir, ".web-tops"), { recursive: true });
    writeFileSync(refused.reportPath, "previous\n");
    expect(await refused.go(["--dry-run"])).toBe(4);
    expect(readFileSync(refused.reportPath, "utf8")).toBe("previous\n");
  });
});
