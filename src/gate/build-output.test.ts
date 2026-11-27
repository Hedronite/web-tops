import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildOutputLayer, type BuildOutputSubLayers } from "./build-output.ts";
import { cfg, noExec } from "./testkit.ts";
import type { GateConfig, Layer, LayerContext, LayerResult } from "./types.ts";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeContext(configPatch: Partial<GateConfig>): LayerContext {
  const cwd = mkdtempSync(join(tmpdir(), "wt-bo-"));
  made.push(cwd);
  return {
    cwd,
    config: cfg(configPatch),
    base: "origin/main",
    enforce: "hard",
    env: {},
    exec: noExec,
    outDir: join(cwd, ".web-tops", "out"),
    artifacts: new Map(),
  };
}

function recordLayer(
  id: string,
  seen: string[],
  result?: Partial<LayerResult>,
  writeJson?: Readonly<{ name: string; subDir: string; payload: unknown }>,
): Layer {
  return {
    id,
    gate: 6,
    tier: 1,
    classes: ["ts-library", "ui-components", "astro-site", "web-app"],
    requires: [],
    produces: writeJson === undefined ? [] : [writeJson.name],
    consumes: [],
    run: (ctx) => {
      seen.push(`${id}:${ctx.artifacts.get("inventory") ?? "none"}`);
      if (writeJson === undefined) {
        return Promise.resolve({ verdict: "pass", findings: [], artifacts: {}, ...result });
      }
      const path = join(ctx.outDir, writeJson.subDir, "report.json");
      mkdirSync(join(ctx.outDir, writeJson.subDir), { recursive: true });
      writeFileSync(path, JSON.stringify(writeJson.payload));
      return Promise.resolve({
        verdict: "pass",
        findings: [],
        artifacts: { [writeJson.name]: path },
        ...result,
      });
    },
  };
}

function defaultSubs(seen: string[]): BuildOutputSubLayers {
  return {
    build: recordLayer(
      "build",
      seen,
      {},
      { name: "inventory", subDir: "build", payload: { version: 1 } },
    ),
    html: recordLayer("html", seen, {}, { name: "html-report", subDir: "html", payload: {} }),
    links: recordLayer("links", seen, {}, { name: "links-json", subDir: "links", payload: {} }),
    bytes: recordLayer(
      "bytes",
      seen,
      {},
      {
        name: "bytes-json",
        subDir: "bytes",
        payload: { pages: [{ route: "/", totalBytes: 1200 }] },
      },
    ),
    routeBytes: recordLayer(
      "route-bytes",
      seen,
      {},
      {
        name: "route-bytes-json",
        subDir: "route-bytes",
        payload: { routes: [{ route: "/app", totalBytes: 3400 }] },
      },
    ),
    axe: recordLayer("axe", seen, {}, { name: "axe-report", subDir: "axe", payload: {} }),
    sizeLimit: recordLayer(
      "size-limit",
      seen,
      {},
      { name: "size-limit-json", subDir: "size-limit", payload: {} },
    ),
  };
}

function fakeSubs(
  seen: string[],
  overrides: Partial<BuildOutputSubLayers> = {},
): BuildOutputSubLayers {
  return { ...defaultSubs(seen), ...overrides };
}

describe("composite build-output orchestrator", () => {
  it("runs build, html, links, bytes, axe in order for astro-site and populates metrics.pages", async () => {
    const seen: string[] = [];
    const ctx = makeContext({ class: "astro-site" });
    const buildNote = {
      tool: "webtops" as const,
      rule: "build:ok",
      verdict: "pass" as const,
      message: "built",
    };
    const result = await buildOutputLayer(
      fakeSubs(seen, {
        build: recordLayer(
          "build",
          seen,
          { findings: [buildNote] },
          { name: "inventory", subDir: "build", payload: { version: 1 } },
        ),
      }),
    ).run(ctx);
    expect(result.verdict).toBe("pass");
    expect(result.findings).toEqual([buildNote]);
    expect(seen.map((item) => item.split(":")[0])).toEqual([
      "build",
      "html",
      "links",
      "bytes",
      "axe",
    ]);
    expect(seen.slice(1).every((item) => item.includes("build/report.json"))).toBe(true);
    expect(result.metrics).toEqual({ pages: [{ route: "/", bytes: 1200 }] });
    expect(Object.keys(result.artifacts).sort()).toEqual([
      "axe-report",
      "bytes-json",
      "html-report",
      "inventory",
      "links-json",
    ]);
  });

  it("runs route-bytes with spaFallback for web-app and populates metrics.pages", async () => {
    const seen: string[] = [];
    const fallbacks: boolean[] = [];
    const ctx = makeContext({ class: "web-app" });
    const subs = fakeSubs(seen, {
      axe: {
        ...recordLayer("axe", seen),
        run: (subCtx) => {
          seen.push("axe:ok");
          fallbacks.push(subCtx.spaFallback === true);
          return Promise.resolve({ verdict: "pass", findings: [], artifacts: {} });
        },
      },
    });
    const result = await buildOutputLayer(subs).run(ctx);
    expect(result.verdict).toBe("pass");
    expect(fallbacks).toEqual([true]);
    expect(seen.map((item) => item.split(":")[0])).toEqual([
      "build",
      "html",
      "links",
      "route-bytes",
      "axe",
    ]);
    expect(result.metrics).toEqual({ pages: [{ route: "/app", bytes: 3400 }] });
  });

  it("respects subLayers enabled toggles for html and axe and records explicit skip findings (A2, W2)", async () => {
    const seen: string[] = [];
    const astroCtx = makeContext({
      class: "astro-site",
      subLayers: {
        html: { enabled: false, reason: "later" },
        axe: { enabled: false },
      },
    });
    const astroRes = await buildOutputLayer(fakeSubs(seen)).run(astroCtx);
    expect(astroRes.verdict).toBe("pass");
    expect(seen.map((item) => item.split(":")[0])).toEqual(["build", "links", "bytes"]);
    expect(astroRes.findings).toEqual([
      { tool: "webtops", rule: "sub-layer:html", verdict: "skip", message: "later" },
      {
        tool: "webtops",
        rule: "sub-layer:axe",
        verdict: "skip",
        message: "disabled in web-tops.yaml",
      },
    ]);

    const appSeen: string[] = [];
    const appCtx = makeContext({
      class: "web-app",
      subLayers: {
        html: { enabled: false, reason: "w2-html" },
        axe: { enabled: false, reason: "w2-axe" },
      },
    });
    const appRes = await buildOutputLayer(fakeSubs(appSeen)).run(appCtx);
    expect(appRes.verdict).toBe("pass");
    expect(appSeen.map((item) => item.split(":")[0])).toEqual(["build", "links", "route-bytes"]);
    expect(appRes.findings).toEqual([
      { tool: "webtops", rule: "sub-layer:html", verdict: "skip", message: "w2-html" },
      { tool: "webtops", rule: "sub-layer:axe", verdict: "skip", message: "w2-axe" },
    ]);
  });

  it("stops on failed build before running downstream sub-layers", async () => {
    const seen: string[] = [];
    const ctx = makeContext({ class: "web-app" });
    const subs = fakeSubs(seen, {
      build: recordLayer("build", seen, { verdict: "fail", reason: "build crashed" }),
    });
    const result = await buildOutputLayer(subs).run(ctx);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("build crashed");
    expect(seen).toEqual(["build:none"]);
  });

  it("aggregates worst sub-layer verdict fail-closed (X3)", async () => {
    const seen: string[] = [];
    const ctx = makeContext({ class: "astro-site" });
    const subs = fakeSubs(seen, {
      links: recordLayer("links", seen, { verdict: "not-evaluated", reason: "no HTML pages" }),
    });
    const result = await buildOutputLayer(subs).run(ctx);
    expect(result.verdict).toBe("not-evaluated");
    expect(result.reason).toBe("no HTML pages");
  });

  it("runs size-limit for ts-library and ui-components and emits skip findings for off/deferred sub-layers (U1/U2/U3)", async () => {
    const libSeen: string[] = [];
    const libOk = await buildOutputLayer(fakeSubs(libSeen)).run(
      makeContext({ class: "ts-library" }),
    );
    expect(libOk.verdict).toBe("pass");
    expect(libOk.findings).toEqual([]);
    expect(Object.keys(libOk.artifacts)).toEqual(["size-limit-json"]);
    expect(libSeen).toEqual(["size-limit:none"]);

    const libOff = await buildOutputLayer(fakeSubs([])).run(
      makeContext({ class: "ts-library", subLayers: { "size-limit": { enabled: false } } }),
    );
    expect(libOff.verdict).toBe("pass");
    expect(libOff.findings).toEqual([
      {
        tool: "webtops",
        rule: "sub-layer:size-limit",
        verdict: "skip",
        message: "disabled in web-tops.yaml",
      },
    ]);

    const uiSeen: string[] = [];
    const uiPublic = await buildOutputLayer(fakeSubs(uiSeen)).run(
      makeContext({
        class: "ui-components",
        subLayers: { html: { enabled: false, reason: "custom-ui" } },
      }),
    );
    expect(uiPublic.verdict).toBe("pass");
    expect(uiSeen).toEqual(["size-limit:none"]);
    expect(uiPublic.findings).toEqual([
      { tool: "webtops", rule: "sub-layer:html", verdict: "skip", message: "custom-ui" },
      {
        tool: "webtops",
        rule: "sub-layer:links",
        verdict: "skip",
        message: "ui-components fixture pages deferred",
      },
      {
        tool: "webtops",
        rule: "sub-layer:axe",
        verdict: "skip",
        message: "ui-components fixture pages deferred",
      },
    ]);

    for (const reason of ["internal", "pkg off"]) {
      const uiOff = await buildOutputLayer(fakeSubs([])).run(
        makeContext({
          class: "ui-components",
          subLayers: { "size-limit": { enabled: false, reason } },
        }),
      );
      expect(uiOff.verdict).toBe("pass");
      expect(uiOff.findings).toEqual([
        { tool: "webtops", rule: "sub-layer:size-limit", verdict: "skip", message: reason },
        {
          tool: "webtops",
          rule: "sub-layer:html",
          verdict: "skip",
          message: "ui-components fixture pages deferred",
        },
        {
          tool: "webtops",
          rule: "sub-layer:links",
          verdict: "skip",
          message: "ui-components fixture pages deferred",
        },
        {
          tool: "webtops",
          rule: "sub-layer:axe",
          verdict: "skip",
          message: "ui-components fixture pages deferred",
        },
      ]);
    }
  });

  it("handles unreadable/malformed byte metrics and attaches fallback reasons cleanly", async () => {
    const seen: string[] = [];
    const ctx = makeContext({ class: "astro-site" });
    const subs = fakeSubs(seen, {
      bytes: {
        ...recordLayer("bytes", seen),
        run: () =>
          Promise.resolve({
            verdict: "pass",
            findings: [],
            artifacts: { "bytes-json": join(ctx.cwd, "missing.json") },
          }),
      },
      links: recordLayer("links", seen, { verdict: "not-evaluated" }),
    });
    const res = await buildOutputLayer(subs).run(ctx);
    expect(res.verdict).toBe("not-evaluated");
    expect(res.reason).toBe("sub-layer not-evaluated");
    expect(res.metrics).toBeUndefined();

    const badJsonPath = join(ctx.cwd, "bad-bytes.json");
    writeFileSync(badJsonPath, '{"pages":[{"route":123}]}');
    const subsBad = fakeSubs(seen, {
      bytes: {
        ...recordLayer("bytes", seen),
        run: () =>
          Promise.resolve({
            verdict: "pass",
            findings: [],
            artifacts: { "bytes-json": badJsonPath },
          }),
      },
      axe: recordLayer("axe", seen, { verdict: "fail" }),
      links: recordLayer("links", seen, { verdict: "pass", reason: "links note" }),
    });
    const badRes = await buildOutputLayer(subsBad).run(ctx);
    expect(badRes.verdict).toBe("fail");
    expect(badRes.reason).toBe("links note");
    expect(badRes.metrics).toBeUndefined();

    const noneRes = await buildOutputLayer(fakeSubs([])).run(
      makeContext({ class: "node-service" }),
    );
    expect(noneRes).toEqual({
      verdict: "not-evaluated",
      reason: "no build-output sub-layer ran",
      findings: [],
      artifacts: {},
    });
  });

  it("exposes contract metadata, forwards sub-layer artifacts and findings, and covers all fallback reasons", async () => {
    const layer = buildOutputLayer();
    expect(layer.classes).toEqual(["ts-library", "ui-components", "astro-site", "web-app"]);
    expect(layer.requires).toEqual([]);
    expect(layer.produces).toEqual([
      "inventory",
      "html-report",
      "links-json",
      "bytes-json",
      "route-bytes-json",
      "axe-report",
      "size-limit-json",
    ]);

    const seen: string[] = [];
    const seenOutDirs: string[] = [];
    const seenFallbacks: boolean[] = [];
    let seenHtmlArtifact: string | undefined;
    const astroFinding = {
      tool: "webtops" as const,
      rule: "links",
      verdict: "pass" as const,
      message: "checked",
    };
    const ctx = makeContext({ class: "astro-site" });
    const subs = fakeSubs(seen, {
      html: {
        ...recordLayer(
          "html",
          seen,
          { verdict: "fail", reason: "r1", findings: [astroFinding] },
          { name: "html-report", subDir: "html", payload: {} },
        ),
        run: (subCtx) => {
          seenOutDirs.push(subCtx.outDir);
          seenFallbacks.push(subCtx.spaFallback === true);
          return recordLayer(
            "html",
            seen,
            { verdict: "fail", reason: "r1", findings: [astroFinding] },
            { name: "html-report", subDir: "html", payload: {} },
          ).run(subCtx);
        },
      },
      links: {
        ...recordLayer("links", seen),
        run: (subCtx) => {
          seenHtmlArtifact = subCtx.artifacts.get("html-report");
          return Promise.resolve({ verdict: "fail", reason: "r2", findings: [], artifacts: {} });
        },
      },
      axe: recordLayer("axe", seen, { verdict: "pass", reason: "ignored" }),
    });
    const res = await buildOutputLayer(subs).run(ctx);
    expect(seenOutDirs).toEqual([join(ctx.outDir, "build-output")]);
    expect(seenFallbacks).toEqual([false]);
    expect(seenHtmlArtifact).toContain("html/report.json");
    expect(res.findings).toEqual([astroFinding]);
    expect(res.reason).toBe("r1; r2");

    const notRunRes = await buildOutputLayer(
      fakeSubs([], {
        sizeLimit: {
          ...recordLayer("size-limit", []),
          run: () => Promise.resolve({ verdict: "not-run", findings: [], artifacts: {} }),
        },
      }),
    ).run(makeContext({ class: "ts-library" }));
    expect(notRunRes.verdict).toBe("not-run");
    expect(notRunRes.reason).toBe("sub-layer not-run");

    const skipFoldReason = await buildOutputLayer(
      fakeSubs([], {
        sizeLimit: {
          ...recordLayer("size-limit", []),
          run: () =>
            Promise.resolve({
              verdict: "skip",
              reason: "internal skip",
              findings: [],
              artifacts: {},
            }),
        },
      }),
    ).run(makeContext({ class: "ts-library" }));
    expect(skipFoldReason.verdict).toBe("pass");
    expect("reason" in skipFoldReason).toBe(false);
    expect(skipFoldReason.findings).toEqual([
      { tool: "webtops", rule: "sub-layer:size-limit", verdict: "skip", message: "internal skip" },
    ]);

    const existingSkip = {
      tool: "webtops" as const,
      rule: "size-limit:skip",
      verdict: "skip" as const,
      message: "already skipped",
    };
    const skipFoldExisting = await buildOutputLayer(
      fakeSubs([], {
        sizeLimit: {
          ...recordLayer("size-limit", []),
          run: () => Promise.resolve({ verdict: "skip", findings: [existingSkip], artifacts: {} }),
        },
      }),
    ).run(makeContext({ class: "ts-library" }));
    expect(skipFoldExisting.verdict).toBe("pass");
    expect(skipFoldExisting.findings).toEqual([existingSkip]);

    const skipFallback = await buildOutputLayer(
      fakeSubs([], {
        sizeLimit: {
          ...recordLayer("size-limit", []),
          run: () => Promise.resolve({ verdict: "skip", findings: [], artifacts: {} }),
        },
      }),
    ).run(makeContext({ class: "ts-library" }));
    expect(skipFallback.verdict).toBe("pass");
    expect(skipFallback.findings).toEqual([
      {
        tool: "webtops",
        rule: "sub-layer:size-limit",
        verdict: "skip",
        message: "sub-layer size-limit skipped",
      },
    ]);

    const failAndSkip = await buildOutputLayer(
      fakeSubs([], {
        axe: recordLayer("axe", [], { verdict: "skip", reason: "axe skip" }),
        links: recordLayer("links", [], { verdict: "fail", reason: "broken link" }),
      }),
    ).run(makeContext({ class: "astro-site" }));
    expect(failAndSkip.verdict).toBe("fail");
    expect(failAndSkip.reason).toBe("broken link");
    expect(failAndSkip.findings).toEqual([
      { tool: "webtops", rule: "sub-layer:axe", verdict: "skip", message: "axe skip" },
    ]);

    const passFinding = {
      tool: "webtops" as const,
      rule: "size-limit:info",
      verdict: "pass" as const,
      message: "info",
    };
    const skipWithNonSkip = await buildOutputLayer(
      fakeSubs([], {
        sizeLimit: {
          ...recordLayer("size-limit", []),
          run: () =>
            Promise.resolve({
              verdict: "skip",
              reason: "with-pass-finding",
              findings: [passFinding],
              artifacts: {},
            }),
        },
      }),
    ).run(makeContext({ class: "ts-library" }));
    expect(skipWithNonSkip.findings).toEqual([
      {
        tool: "webtops",
        rule: "sub-layer:size-limit",
        verdict: "skip",
        message: "with-pass-finding",
      },
      passFinding,
    ]);

    const skippedBuild = await buildOutputLayer(
      fakeSubs([], {
        build: recordLayer(
          "build",
          [],
          { verdict: "skip" },
          { name: "inventory", subDir: "build", payload: { version: 1 } },
        ),
      }),
    ).run(makeContext({ class: "astro-site" }));
    expect(skippedBuild.verdict).toBe("pass");
    expect(Object.keys(skippedBuild.artifacts)).toEqual(["inventory"]);
    expect(skippedBuild.findings).toEqual([
      {
        tool: "webtops",
        rule: "sub-layer:build",
        verdict: "skip",
        message: "sub-layer build skipped",
      },
    ]);

    const skippedAstro = await buildOutputLayer(
      fakeSubs([], {
        links: recordLayer("links", [], { verdict: "skip" }),
        bytes: recordLayer("bytes", [], { verdict: "skip" }),
      }),
    ).run(makeContext({ class: "astro-site" }));
    expect(skippedAstro.findings).toEqual([
      {
        tool: "webtops",
        rule: "sub-layer:links",
        verdict: "skip",
        message: "sub-layer links skipped",
      },
      {
        tool: "webtops",
        rule: "sub-layer:bytes",
        verdict: "skip",
        message: "sub-layer bytes skipped",
      },
    ]);

    const skippedApp = await buildOutputLayer(
      fakeSubs([], { routeBytes: recordLayer("route-bytes", [], { verdict: "skip" }) }),
    ).run(makeContext({ class: "web-app" }));
    expect(skippedApp.findings).toEqual([
      {
        tool: "webtops",
        rule: "sub-layer:route-bytes",
        verdict: "skip",
        message: "sub-layer route-bytes skipped",
      },
    ]);

    const noReasonFail = await buildOutputLayer(
      fakeSubs([], {
        sizeLimit: {
          ...recordLayer("size-limit", []),
          run: () => Promise.resolve({ verdict: "fail", findings: [], artifacts: {} }),
        },
      }),
    ).run(makeContext({ class: "ts-library" }));
    expect(noReasonFail.verdict).toBe("fail");
    expect("reason" in noReasonFail).toBe(false);
  });
});
