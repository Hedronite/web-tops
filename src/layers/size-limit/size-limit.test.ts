import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../config/validate.ts";
import { toGateConfig } from "../../gate/adapter.ts";
import { realExec } from "../../gate/exec.ts";
import { runGate, sourceReader } from "../../gate/runner.ts";
import { cfg, opts, tempProject, tickingClock } from "../../gate/testkit.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import type { Exec, GateConfig } from "../../gate/types.ts";
import { DEFAULT_ENTRY_BYTES, budgetForEntry } from "./budgets.ts";
import { readManifestInfo, resolveExportEntries } from "./exports.ts";
import { sizeLimitLayer } from "./index.ts";

const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;
const root = resolve(import.meta.dirname, "../../..");
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function makeProject() {
  const project = tempProject();
  cleanups.push(() => {
    project.cleanup();
  });
  return project;
}

function put(dir: string, file: string, text: string): string {
  const path = join(dir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

function linkKitModules(dir: string): void {
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
}

function runWith(config: GateConfig, cwd: string, exec: Exec = boundedExec) {
  return runGate({
    layers: [sizeLimitLayer],
    config,
    options: opts(),
    cwd,
    env: process.env,
    exec,
    outDir: join(cwd, ".web-tops", "out"),
    now: tickingClock(),
  });
}

const boundedExec: Exec = (cmd, args, options) =>
  realExec(cmd, args, { ...options, timeoutMs: REAL_TOOL_TIMEOUT });

function assertFailedEntry(
  report: Awaited<ReturnType<typeof runWith>>,
  expectedFile: string,
  expectedMsg: RegExp,
): void {
  const layer = report.layers.find((entry) => entry.id === "size-limit");
  expect(layer).toBeDefined();
  if (layer === undefined) return;
  const failed = layer.findings.filter((f) => f.verdict === "fail");
  expect(failed).toHaveLength(1);
  expect(failed[0]?.file).toBe(expectedFile);
  expect(failed[0]?.message).toMatch(expectedMsg);
}

function getProp(target: unknown, key: string | number): unknown {
  return typeof target === "object" && target !== null ? Reflect.get(target, key) : undefined;
}

function firstMeasuredSize(saved: string): number {
  const parsed: unknown = JSON.parse(saved);
  const size = getProp(getProp(getProp(parsed, "entries"), 0), "size");
  if (typeof size !== "number") throw new Error("missing first measured entry size");
  return size;
}

function firstFinding(report: Awaited<ReturnType<typeof runWith>>) {
  const layer = report.layers.find((entry) => entry.id === "size-limit");
  const finding = layer?.findings[0];
  if (finding === undefined) throw new Error("missing first size-limit finding");
  return finding;
}

function configFrom(yaml: string): GateConfig {
  const parsed = parseConfig(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return toGateConfig(parsed.value, { dependsOnAstro: false });
}

describe("M4 G7: export resolution and budget precedence", () => {
  it("resolves string, condition-map, and conditional subpath exports while skipping types and ./package.json", () => {
    const { dir } = makeProject();
    put(dir, "dist/index.js", "export const a = 1;\n");
    put(dir, "dist/index.d.ts", "export declare const a: number;\n");
    put(dir, "dist/sub.js", "export const b = 2;\n");

    const strRes = resolveExportEntries(dir, "./dist/index.js");
    expect(strRes.ok).toBe(true);
    if (strRes.ok)
      expect(strRes.entries.map((e) => [e.key, e.file])).toEqual([[".", "dist/index.js"]]);

    const condRes = resolveExportEntries(dir, {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    });
    expect(condRes.ok).toBe(true);
    if (condRes.ok) expect(condRes.entries.map((e) => e.key)).toEqual(["."]);

    put(dir, "dist/index.d.ts.js", "export const dotDtsJs = 3;\n");
    const mapRes = resolveExportEntries(dir, {
      "./sub": { custom: 1, require: "./dist/sub.js" },
      ".": { types: "./dist/index.d.mts", module: [null, "./dist/index.d.cts", "./dist/index.js"] },
      "./edge": { browser: "./dist/index.d.ts.js" },
      "./empty-arr": [123],
      "./bad": null,
      "./types-only": { types: "./dist/index.d.ts" },
      "./*": "./dist/*.js",
      "./package.json": "./package.json",
    });
    expect(mapRes.ok).toBe(true);
    if (mapRes.ok) {
      expect(mapRes.entries.map((e) => [e.key, e.file])).toEqual([
        [".", "dist/index.js"],
        ["./edge", "dist/index.d.ts.js"],
        ["./sub", "dist/sub.js"],
      ]);
      expect(resolveExportEntries(dir, { default: "./dist/index.js" }).ok).toBe(true);
      expect(resolveExportEntries(dir, { node: "./dist/sub.js" }).ok).toBe(true);
      expect(
        resolveExportEntries(dir, {
          import: "./dist/index.d.ts",
          require: "./dist/sub.js",
        }),
      ).toMatchObject({ ok: true, entries: [{ key: ".", file: "dist/sub.js" }] });
      expect(
        resolveExportEntries(dir, {
          "./sub": "./dist/sub.js",
          extra: 123,
        }),
      ).toMatchObject({ ok: true, entries: [{ key: "./sub", file: "dist/sub.js" }] });
      expect(resolveExportEntries(dir, "./dist/index.d.ts")).toEqual({
        ok: false,
        reason: "package.json exports has no measurable runtime entries",
      });
      expect(resolveExportEntries(dir, { types: "./dist/index.d.ts" })).toEqual({
        ok: false,
        reason: "package.json exports has no measurable runtime entries",
      });
      expect(resolveExportEntries(dir, 123)).toEqual({
        ok: false,
        reason: "package.json exports has no measurable runtime entries",
      });
      expect(resolveExportEntries(dir, undefined)).toEqual({
        ok: false,
        reason: "package.json declares no exports field",
      });
      expect(resolveExportEntries(dir, ".")).toEqual({
        ok: false,
        file: ".",
        reason: 'export "." target "." escapes project root',
      });
      expect(resolveExportEntries(dir, "../outside.js")).toEqual({
        ok: false,
        file: "../outside.js",
        reason: 'export "." target "../outside.js" escapes project root',
      });
      expect(resolveExportEntries(dir, "./dist/missing.js")).toEqual({
        ok: false,
        file: "./dist/missing.js",
        reason: 'export "." target "./dist/missing.js" does not exist',
      });
    }
  });

  it("applies entry budget precedence (layers.size_limit.entries > budgets.entries > default_bytes > class default)", () => {
    expect(budgetForEntry(".", undefined)).toBe(51_200);
    expect(budgetForEntry(".", {})).toBe(51_200);
    expect(DEFAULT_ENTRY_BYTES).toBe(51_200);
    expect(budgetForEntry(".", { defaultBytes: 4096 })).toBe(4096);
    const merged = configFrom(
      'protocol: "0.3.0"\nversion: "1"\npackage: p\nclass: ts-library\nbudgets:\n  entries:\n    ".": 2000\n    "./a": 3000\nlayers:\n  size_limit:\n    default_bytes: 5000\n    entries:\n      ".": 1500\n',
    ).sizeLimit;
    expect(budgetForEntry(".", merged)).toBe(1500);
    expect(budgetForEntry("./a", merged)).toBe(3000);
    expect(budgetForEntry("./other", merged)).toBe(5000);
  });
});

describe.skipIf(insideStryker)(
  "M4 G7: size-limit 14.3.0 + @size-limit/file real measurement and budget checks",
  () => {
    it(
      "measures each exports entry cleanly and passes under budget",
      async () => {
        const { dir } = makeProject();
        linkKitModules(dir);
        put(
          dir,
          "package.json",
          JSON.stringify({
            name: "small-lib",
            version: "1.0.0",
            type: "module",
            exports: {
              ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
              "./extra": "./dist/extra.js",
              "./package.json": "./package.json",
            },
          }),
        );
        put(dir, "dist/index.d.ts", "export declare const main: number;\n");
        put(dir, "dist/index.js", "export const main = 1;\n");
        put(dir, "dist/extra.js", "export const extra = 2;\n");

        const config = configFrom(
          'protocol: "0.3.0"\nversion: "1"\npackage: small-lib\nclass: ts-library\nbudgets:\n  entries:\n    "./extra": 2048\nlayers:\n  size_limit:\n    default_bytes: 4096\n',
        );
        const report = await runWith(config, dir);
        expect(report.passed).toBe(true);
        expect(report.exit_code).toBe(0);
        const layer = report.layers.find((entry) => entry.id === "size-limit");
        expect(layer?.findings).toHaveLength(2);
        const saved = readFileSync(join(dir, ".web-tops/out/size-limit/report.json"), "utf8");
        expect(saved).toContain('"skipped": false');
        const exactBudget = firstMeasuredSize(saved);
        const exactCfg = configFrom(
          `protocol: "0.3.0"\nversion: "1"\npackage: small-lib\nclass: ts-library\nlayers:\n  size_limit:\n    entries:\n      ".": ${String(exactBudget)}\n      "./extra": 2048\n`,
        );
        expect((await runWith(exactCfg, dir)).passed).toBe(true);
      },
      REAL_TOOL_TIMEOUT,
    );

    it(
      "fails a planted over-budget exports entry with entry key, file, measured size, and budget",
      async () => {
        const { dir } = makeProject();
        linkKitModules(dir);
        const noisy = Array.from(
          { length: 120 },
          (_, i) => `export const k${String(i)} = "${String(i * 7919)}";`,
        ).join("\n");
        put(
          dir,
          "package.json",
          JSON.stringify({
            name: "fat-lib",
            version: "1.0.0",
            type: "module",
            exports: { ".": "./dist/index.js", "./big": "./dist/big.js" },
          }),
        );
        put(dir, "dist/index.js", "export const ok = 1;\n");
        put(dir, "dist/big.js", `${noisy}\n`);

        const config = configFrom(
          'protocol: "0.3.0"\nversion: "1"\npackage: fat-lib\nclass: ts-library\nlayers:\n  size_limit:\n    entries:\n      ".": 1024\n      "./big": 40\n',
        );
        const report = await runWith(config, dir);
        expect(report.passed).toBe(false);
        expect(report.exit_code).toBe(1);
        const layer = report.layers.find((entry) => entry.id === "size-limit");
        if (layer === undefined) throw new Error("missing size-limit layer");
        expect(layer.artifacts).toEqual([".web-tops/out/size-limit/report.json"]);
        expect(layer.findings.map((f) => [f.verdict, f.rule])).toEqual([
          ["pass", "size-limit"],
          ["fail", "size-limit"],
        ]);
        expect(layer.findings[0]?.message).toContain("<=");
        expect(layer.findings[1]?.message).toContain("exceeds budget");
        assertFailedEntry(report, "dist/big.js", /\.\/big.*40 B/);
      },
      REAL_TOOL_TIMEOUT,
    );

    it(
      "fails closed when size-limit returns an entry without numeric size in real node",
      async () => {
        const mockPkg = makeProject().dir;
        put(
          mockPkg,
          "package.json",
          JSON.stringify({ name: "ok-pkg", exports: { ".": "./index.js" } }),
        );
        put(mockPkg, "index.js", "export const x = 1;\n");
        put(
          mockPkg,
          "node_modules/size-limit/package.json",
          JSON.stringify({ name: "size-limit" }),
        );
        put(mockPkg, "node_modules/size-limit/index.js", "export default async () => [{}];\n");
        put(mockPkg, "node_modules/@size-limit/file/package.json", JSON.stringify({ name: "f" }));
        put(mockPkg, "node_modules/@size-limit/file/index.js", "export default [];\n");
        const realThrows = await runWith(cfg({ class: "ts-library" }), mockPkg);
        expect(realThrows.passed).toBe(false);
        expect(firstFinding(realThrows).message).toContain("size-limit produced no size for .");
      },
      REAL_TOOL_TIMEOUT,
    );
  },
);

describe("M4 G7: skip_private and fail-closed error handling", () => {
  it("skips a private: true package with skip_private reason without invoking node", async () => {
    const { dir } = makeProject();
    put(dir, "package.json", JSON.stringify({ name: "internal", private: true }));
    let execCalled = false;
    const config = cfg({
      class: "ts-library",
      sizeLimit: { skipPrivate: "internal utility is never published" },
    });
    const result = await sizeLimitLayer.run({
      cwd: dir,
      config,
      base: "origin/main",
      enforce: "hard",
      env: process.env,
      exec: () => {
        execCalled = true;
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
      outDir: join(dir, ".web-tops", "out"),
      artifacts: new Map(),
    });
    expect(execCalled).toBe(false);
    expect(result.verdict).toBe("skip");
    expect(result.reason).toBe("internal utility is never published");
    expect(result.artifacts["size-limit-json"]).toBe(
      join(dir, ".web-tops/out/size-limit/report.json"),
    );
    expect(result.findings[0]).toMatchObject({
      rule: "size-limit",
      verdict: "skip",
      message: "internal utility is never published",
    });
    const saved: unknown = JSON.parse(
      readFileSync(join(dir, ".web-tops/out/size-limit/report.json"), "utf8"),
    );
    expect(saved).toEqual({
      skipped: true,
      reason: "internal utility is never published",
      entries: [],
    });
    expect(sizeLimitLayer.classes).toEqual(["ts-library", "ui-components"]);
    expect(sizeLimitLayer.requires).toEqual([]);
    expect(sizeLimitLayer.produces).toEqual(["size-limit-json"]);
    expect(sizeLimitLayer.consumes).toEqual([]);
  });

  it.each([
    ["non-private package", { name: "pub", private: false }, { skipPrivate: "not published" }],
    ['private: "true" string', { name: "pub", private: "true" }, { skipPrivate: "not published" }],
    ["blank skip_private reason", { name: "priv", private: true }, { skipPrivate: "   " }],
  ])("never silently skips when %s", async (_what, manifest, sizeLimit) => {
    const { dir } = makeProject();
    put(dir, "package.json", JSON.stringify(manifest));
    const report = await runWith(cfg({ class: "ts-library", sizeLimit }), dir);
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(1);
    const finding = firstFinding(report);
    expect(finding).toMatchObject({ rule: "size-limit", verdict: "fail" });
    expect(finding.message).toContain("skip_private");
  });

  it("reports explicit size-limit findings on missing manifests, targets, and tool failures", async () => {
    const missingPkg = makeProject().dir;
    expect(readManifestInfo(missingPkg)).toEqual({ ok: false, reason: "package.json is missing" });
    expect(firstFinding(await runWith(cfg({ class: "ts-library" }), missingPkg))).toMatchObject({
      rule: "size-limit",
      verdict: "fail",
      message: "package.json is missing",
    });

    const brokenPkg = makeProject().dir;
    put(brokenPkg, "package.json", "{broken");
    const manifestErr = readManifestInfo(brokenPkg);
    expect(manifestErr.ok).toBe(false);
    if (!manifestErr.ok) expect(manifestErr.reason).toContain("package.json is unreadable:");
    const brokenFinding = firstFinding(await runWith(cfg({ class: "ts-library" }), brokenPkg));
    expect(brokenFinding.rule).toBe("size-limit");
    expect(brokenFinding.message).toContain("package.json is unreadable:");

    const arrPkg = makeProject().dir;
    put(arrPkg, "package.json", "[]");
    expect(readManifestInfo(arrPkg)).toEqual({
      ok: false,
      reason: "package.json must be a JSON object",
    });

    const missingTarget = makeProject().dir;
    put(
      missingTarget,
      "package.json",
      JSON.stringify({ name: "miss", exports: { ".": "./dist/missing.js" } }),
    );
    expect(firstFinding(await runWith(cfg({ class: "ts-library" }), missingTarget))).toMatchObject({
      rule: "size-limit",
      file: "./dist/missing.js",
      message: 'export "." target "./dist/missing.js" does not exist',
    });

    const escapeTarget = makeProject().dir;
    put(
      escapeTarget,
      "package.json",
      JSON.stringify({ name: "esc", exports: { ".": "../outside.js" } }),
    );
    expect(firstFinding(await runWith(cfg({ class: "ts-library" }), escapeTarget))).toMatchObject({
      file: "../outside.js",
      message: 'export "." target "../outside.js" escapes project root',
    });

    const dirAndSym = makeProject().dir;
    put(dirAndSym, "dist/inside.js", "export const ok = 1;\n");
    const outside = makeProject().dir;
    put(outside, "ext.js", "export const ext = 1;\n");
    put(dirAndSym, "package.json", JSON.stringify({ name: "dir-pkg", exports: { ".": "./dist" } }));
    expect(firstFinding(await runWith(cfg({ class: "ts-library" }), dirAndSym))).toMatchObject({
      file: "./dist",
      message: 'export "." target "./dist" is not a readable file',
    });
    symlinkSync(join(outside, "ext.js"), join(dirAndSym, "dist/sym.js"));
    put(
      dirAndSym,
      "package.json",
      JSON.stringify({ name: "sym-pkg", exports: { ".": "./dist/sym.js" } }),
    );
    expect(firstFinding(await runWith(cfg({ class: "ts-library" }), dirAndSym))).toMatchObject({
      file: "./dist/sym.js",
      message: 'export "." target "./dist/sym.js" is not a readable file',
    });

    const noTools = makeProject().dir;
    put(noTools, "package.json", JSON.stringify({ name: "nt", exports: { ".": "./index.js" } }));
    put(noTools, "index.js", "export const x = 1;\n");
    expect(firstFinding(await runWith(cfg({ class: "ts-library" }), noTools))).toMatchObject({
      rule: "size-limit",
      message: "size-limit or @size-limit/file is not installed in node_modules",
    });
  });

  it("handles mocked exec errors, malformed JSON rows, and runnerScript failures explicitly", async () => {
    const mockPkg = makeProject().dir;
    put(
      mockPkg,
      "package.json",
      JSON.stringify({ name: "ok-pkg", exports: { ".": "./index.js" } }),
    );
    put(mockPkg, "index.js", "export const x = 1;\n");
    put(mockPkg, "node_modules/size-limit/package.json", JSON.stringify({ name: "size-limit" }));
    put(mockPkg, "node_modules/size-limit/index.js", "export default async () => [{}];\n");
    put(mockPkg, "node_modules/@size-limit/file/package.json", "{bad");
    expect(firstFinding(await runWith(cfg({ class: "ts-library" }), mockPkg)).message).toBe(
      "size-limit or @size-limit/file is not installed in node_modules",
    );

    put(mockPkg, "node_modules/@size-limit/file/package.json", JSON.stringify({ name: "f" }));
    expect(firstFinding(await runWith(cfg({ class: "ts-library" }), mockPkg)).message).toBe(
      "size-limit or @size-limit/file is not installed in node_modules",
    );
    put(mockPkg, "node_modules/@size-limit/file/index.js", "export default [];\n");

    let recordedCmd = "";
    let recordedArg = "";
    let recordedTimeout: number | undefined;
    const stdoutErr = await runWith(cfg({ class: "ts-library" }), mockPkg, (cmd, args, opt) => {
      recordedCmd = cmd;
      recordedArg = String(args[0]);
      recordedTimeout = opt?.timeoutMs;
      return Promise.resolve({ code: null, stdout: "  stdout problem  ", stderr: "   " });
    });
    expect(recordedCmd).toBe("node");
    expect(recordedArg.endsWith("/size-limit/measure.mjs")).toBe(true);
    expect(recordedTimeout).toBe(60_000);
    const scriptText = readFileSync(recordedArg, "utf8");
    for (const fragment of [
      "import sizeLimit from",
      "import filePlugin from",
      "const entries =",
      "await sizeLimit(filePlugin, [entry.absPath])",
      'typeof measured?.size !== "number"',
      "size-limit produced no size for",
      "results.push({ key: entry.key, file: entry.file, size: measured.size })",
      "process.stdout.write(JSON.stringify({ results }))",
    ]) {
      expect(scriptText).toContain(fragment);
    }
    expect(firstFinding(stdoutErr).message).toBe("size-limit failed (exit null: stdout problem)");

    expect(
      firstFinding(
        await runWith(cfg({ class: "ts-library" }), mockPkg, () =>
          Promise.resolve({ code: 1, stdout: "", stderr: "  stderr problem  " }),
        ),
      ).message,
    ).toBe("size-limit failed (exit 1: stderr problem)");
    expect(
      firstFinding(
        await runWith(cfg({ class: "ts-library" }), mockPkg, () =>
          Promise.resolve({ code: 2, stdout: "", stderr: "" }),
        ),
      ).message,
    ).toBe("size-limit failed (exit 2)");
    expect(
      firstFinding(
        await runWith(cfg({ class: "ts-library" }), mockPkg, () =>
          Promise.resolve({ code: 0, stdout: "", stderr: "", failure: "tool-timeout" }),
        ),
      ).message,
    ).toBe("size-limit failed (tool-timeout)");
  });

  it("rejects non-JSON and invalid JSON result payloads from size-limit exec", async () => {
    const mockPkg = makeProject().dir;
    put(
      mockPkg,
      "package.json",
      JSON.stringify({ name: "ok-pkg", exports: { ".": "./index.js" } }),
    );
    put(mockPkg, "index.js", "export const x = 1;\n");
    put(mockPkg, "node_modules/size-limit/package.json", JSON.stringify({ name: "size-limit" }));
    put(mockPkg, "node_modules/size-limit/index.js", "");
    put(mockPkg, "node_modules/@size-limit/file/package.json", JSON.stringify({ name: "f" }));
    put(mockPkg, "node_modules/@size-limit/file/index.js", "");

    const badPayloads = [
      "not json",
      "null",
      "123",
      "[]",
      "{}",
      JSON.stringify({ results: [] }),
      JSON.stringify({ results: [null] }),
      JSON.stringify({ results: [{ key: 1, file: "index.js", size: 10 }] }),
      JSON.stringify({ results: [{ key: ".", file: 1, size: 10 }] }),
      JSON.stringify({ results: [{ key: ".", file: "index.js", size: "bad" }] }),
    ];
    for (const stdout of badPayloads) {
      const report = await runWith(cfg({ class: "ts-library" }), mockPkg, () =>
        Promise.resolve({ code: 0, stdout, stderr: "" }),
      );
      expect(firstFinding(report).message).toBe("size-limit printed an unreadable JSON result");
    }
  });

  it("evaluates exact boundary and over-budget entries via mocked exec without spawning node", async () => {
    const { dir } = makeProject();
    put(
      dir,
      "package.json",
      JSON.stringify({ name: "fast-lib", exports: { ".": "./dist/a.js", "./big": "./dist/b.js" } }),
    );
    put(dir, "dist/a.js", "export const a = 1;\n");
    put(dir, "dist/b.js", "export const b = 2;\n");
    put(
      dir,
      "node_modules/size-limit/package.json",
      JSON.stringify({ name: "size-limit", main: "custom.mjs" }),
    );
    put(dir, "node_modules/size-limit/custom.mjs", "export default async () => [];\n");
    put(dir, "node_modules/@size-limit/file/package.json", JSON.stringify({ name: "f" }));
    put(dir, "node_modules/@size-limit/file/index.js", "export default [];\n");

    let seenScript = "";
    const fakeExec: Exec = (_cmd, args) => {
      seenScript = readFileSync(String(args[0]), "utf8");
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({
          results: [
            { key: ".", file: "dist/a.js", size: 100 },
            { key: "./big", file: "dist/b.js", size: 101 },
          ],
        }),
        stderr: "",
      });
    };

    const passCfg = configFrom(
      'protocol: "0.3.0"\nversion: "1"\npackage: fast-lib\nclass: ts-library\nlayers:\n  size_limit:\n    entries:\n      ".": 100\n      "./big": 101\n',
    );
    expect(passCfg.sizeLimit).toEqual({ entries: { ".": 100, "./big": 101 } });
    const passed = await runWith(passCfg, dir, fakeExec);
    expect(passed.passed).toBe(true);
    const slUrl = pathToFileURL(
      join(realpathSync(join(dir, "node_modules/size-limit")), "custom.mjs"),
    ).href;
    const fpUrl = pathToFileURL(
      join(realpathSync(join(dir, "node_modules/@size-limit/file")), "index.js"),
    ).href;
    const expectedEntries = JSON.stringify([
      { key: ".", file: "dist/a.js", absPath: join(realpathSync(dir), "dist/a.js") },
      { key: "./big", file: "dist/b.js", absPath: join(realpathSync(dir), "dist/b.js") },
    ]);
    expect(seenScript).toBe(
      [
        `import sizeLimit from ${JSON.stringify(slUrl)};`,
        `import filePlugin from ${JSON.stringify(fpUrl)};`,
        `const entries = ${expectedEntries};`,
        "const results = [];",
        "for (const entry of entries) {",
        "  const [measured] = await sizeLimit(filePlugin, [entry.absPath]);",
        '  if (typeof measured?.size !== "number") {',
        "    throw new Error(`size-limit produced no size for ${entry.key}`);",
        "  }",
        "  results.push({ key: entry.key, file: entry.file, size: measured.size });",
        "}",
        "process.stdout.write(JSON.stringify({ results }));",
        "",
      ].join("\n"),
    );
    const passLayer = passed.layers.find((entry) => entry.id === "size-limit");
    if (passLayer === undefined) throw new Error("missing size-limit layer");
    expect(passLayer.artifacts).toEqual([".web-tops/out/size-limit/report.json"]);
    expect(passLayer.findings[0]?.message).toContain("<=");
    expect(readFileSync(join(dir, ".web-tops/out/size-limit/report.json"), "utf8")).toContain(
      '"skipped": false',
    );

    const failCfg = cfg({
      class: "ts-library",
      sizeLimit: { entries: { ".": 100, "./big": 100 } },
    });
    const failed = await runWith(failCfg, dir, fakeExec);
    expect(failed.passed).toBe(false);
    const layer = failed.layers.find((entry) => entry.id === "size-limit");
    if (layer === undefined) throw new Error("missing size-limit layer");
    expect(layer.findings.map((f) => [f.verdict, f.rule])).toEqual([
      ["pass", "size-limit"],
      ["fail", "size-limit"],
    ]);
    assertFailedEntry(failed, "dist/b.js", /\.\/big.*101 B \(exceeds budget 100 B\)/);
  });
  it("returns undefined from sourceReader when a finding path escapes cwd", () => {
    const { dir } = makeProject();
    const work = join(dir, "work");
    mkdirSync(work, { recursive: true });
    writeFileSync(join(dir, "secret.txt"), "secret");
    writeFileSync(join(work, "inside.txt"), "inside");
    const read = sourceReader(work);
    expect(read("inside.txt")).toBe("inside");
    expect(read("../secret.txt")).toBeUndefined();
  });
});
