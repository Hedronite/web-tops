import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../config/validate.ts";
import { toGateConfig } from "../../gate/adapter.ts";
import { runGate, sourceReader } from "../../gate/runner.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import { opts, tempProject, tickingClock } from "../../gate/testkit.ts";
import type { LayerContext } from "../../gate/types.ts";
import type { GateConfig } from "../../gate/types.ts";
import { BROTLI_OPTIONS, buildLayer } from "../build/index.ts";
import {
  ASTRO_ISLAND_JS_BYTES,
  ASTRO_STATIC_JS_BYTES,
  WEB_APP_ROUTE_JS_BYTES,
  budgetForPage,
} from "./budgets.ts";
import { extractStaticImports, resolvePageModuleClosure } from "./closure.ts";
import { extractPageScripts } from "./html.ts";
import { brotliBytes, bytesLayer, createBrotliCache, type PageBytesReport } from "./index.ts";

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

function configFrom(yaml: string): GateConfig {
  const parsed = parseConfig(yaml);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
  return toGateConfig(parsed.value, { dependsOnAstro: true });
}

function runBytesGate(cwd: string, config: GateConfig) {
  return runGate({
    layers: [buildLayer, bytesLayer],
    config,
    options: opts(),
    cwd,
    env: process.env,
    exec: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    outDir: join(cwd, ".web-tops", "out"),
    now: tickingClock(),
  });
}

function isPageReport(value: unknown): value is PageBytesReport {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "totalBytes") === "number"
  );
}

function readBytesReport(cwd: string): readonly PageBytesReport[] {
  const raw: unknown = JSON.parse(
    readFileSync(join(cwd, ".web-tops/out/bytes/report.json"), "utf8"),
  );
  const pages: unknown =
    typeof raw === "object" && raw !== null ? Reflect.get(raw, "pages") : undefined;
  if (!Array.isArray(pages)) throw new Error("invalid bytes report");
  return pages.filter(isPageReport);
}

function compressWithRuntime(runtime: string, cwd: string, inputs: readonly string[]): number[] {
  const code = [
    'import { brotliCompressSync, constants } from "node:zlib";',
    `const opts = { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 22 } };`,
    `const items = ${JSON.stringify(inputs)};`,
    'const out = items.map((item) => brotliCompressSync(Buffer.from(item, "utf8"), opts).length);',
    "process.stdout.write(JSON.stringify(out));",
  ].join("\n");
  const res = spawnSync(runtime, ["-e", code], {
    cwd,
    encoding: "utf8",
    timeout: REAL_TOOL_TIMEOUT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(res.status, `runtime=${runtime} stderr=${res.stderr}`).toBe(0);
  const parsed: unknown = JSON.parse(res.stdout);
  if (!Array.isArray(parsed)) throw new Error("expected array");
  return Array.from({ length: parsed.length }, (_, i) => Number(Reflect.get(parsed, i)));
}

describe("M4 G4: page JS budget resolution", () => {
  it("resolves per-page, astro-site static vs island, web-app, and fallback precedence", () => {
    expect(budgetForPage("/", "astro-site", false, undefined)).toBe(0);
    expect(budgetForPage("/", "astro-site", true, undefined)).toBe(51_200);
    expect(budgetForPage("/", "web-app", false, undefined)).toBe(174_080);
    expect([ASTRO_STATIC_JS_BYTES, ASTRO_ISLAND_JS_BYTES, WEB_APP_ROUTE_JS_BYTES]).toEqual([
      0, 51_200, 174_080,
    ]);
    const custom = {
      pageJsBytes: 40_000,
      staticPageJsBytes: 128,
      routeJsBytes: 120_000,
      pages: { "/big/": 99_999 },
    };
    expect(budgetForPage("/big/", "astro-site", false, custom)).toBe(99_999);
    expect(budgetForPage("/home/", "astro-site", false, custom)).toBe(128);
    expect(budgetForPage("/app/", "astro-site", true, custom)).toBe(40_000);
    expect(budgetForPage("/app/", "web-app", false, custom)).toBe(120_000);
    expect(budgetForPage("/app/", "astro-site", false, { pageJsBytes: 4_096 })).toBe(4_096);
    expect(budgetForPage("/app/", "web-app", false, { pageJsBytes: 8_192 })).toBe(8_192);
    expect(budgetForPage("/app/", "astro-site", false, {})).toBe(ASTRO_STATIC_JS_BYTES);
    expect(budgetForPage("/app/", "astro-site", true, {})).toBe(ASTRO_ISLAND_JS_BYTES);
    expect(budgetForPage("/app/", "web-app", false, {})).toBe(WEB_APP_ROUTE_JS_BYTES);
  });
});

describe("M4 G4: inline JS, data script exclusion, static ESM closure, and Node vs Bun parity", () => {
  it("excludes JSON, JSON-LD, importmap, speculationrules, whitespace, and HTML comments as 0 B JS", async () => {
    const { dir } = makeProject();
    put(
      dir,
      "dist/index.html",
      [
        "<!doctype html><html><head>",
        '<script type="application/json">{"big": "data payload should not count"}</script>',
        '<script type="application/ld+json">{"@context": "https://schema.org"}</script>',
        '<script type="importmap">{"imports": {"x": "/x.js"}}</script>',
        '<script type="speculationrules">{"prefetch": []}</script>',
        '<script src=" https://cdn.example.com/analytics.js "></script>',
        '<script src="//cdn.example.com/proto.js"></script>',
        '<script src=""></script>',
        "<!-- <script>window.ignored = 1;</script> -->",
        "<script>   \n  </script>",
        "</head><body><h1>Static</h1></body></html>",
      ].join("\n"),
    );
    const report = await runBytesGate(
      dir,
      configFrom('protocol: "0.3.0"\nversion: "1"\npackage: site\nclass: astro-site\n'),
    );
    expect(report.passed).toBe(true);
    const layer = report.layers.find((l) => l.id === "bytes");
    if (layer === undefined) throw new Error("missing bytes layer");
    expect(layer.artifacts).toEqual([".web-tops/out/bytes/report.json"]);
    expect(layer.findings[0]).toMatchObject({
      rule: "W-29",
      law: "W-29",
      verdict: "pass",
      file: "index.html",
    });
    expect(layer.findings[0]?.message).toContain("<=");
    const pages = readBytesReport(dir);
    expect(pages).toMatchObject([
      { totalBytes: 0, inlineBytes: 0, moduleBytes: 0, hasIsland: false },
    ]);
  });

  it(
    "counts inline JS (> 0 B) and static ESM import/re-export closure without lazy import() or cycles",
    async () => {
      const { dir } = makeProject();
      const inline1 = 'import "./assets/entry.js?v=1#main";';
      const inline2 =
        'import "/reexp.js#onlyhash"; import "/solo2.js ?v=1"; import "bare-pkg"; window.__BOOT__ = 1234567890;';
      const entryJs = [
        'import { a } from "./chunk-a.js";',
        'import "../side.js";',
        'import "https://cdn.example.com/pkg.js";',
        'import "//cdn.example.com/proto.js";',
        'import "bare-pkg";',
        'export * from "/reexp.js";',
        `const fake = 'import "./fake.js"';`,
        'const lazy = () => import("./lazy.js");',
        "export { a, fake, lazy };",
      ].join("\n");
      const chunkA = 'import { s } from "/shared.js"; export const a = s + 1;';
      const shared = 'import "./assets/chunk-a.js"; export const s = 2;';
      const side = "window.__SIDE__ = true;";
      const reexp = "export const r = 3;";
      const solo1 = "window.__SOLO1__ = 1;";
      const solo2 = "window.__SOLO2__ = 2;";

      put(
        dir,
        "dist/index.html",
        [
          "<!doctype html><html><head>",
          '<link rel="preload modulepreload" href=" /shared.js">',
          '<script type="module" src="/solo1.js"></script>',
          '<script type="module" src="/assets/entry.js?v=2#frag"></script>',
          `<script type="module">${inline1}</script>`,
          `<script type="module">${inline2}</script>`,
          "</head><body><astro-island></astro-island></body></html>",
        ].join("\n"),
      );
      put(
        dir,
        "dist/second.html",
        '<!doctype html><html><head><script type="module" src="/shared.js"></script></head><body><astro-island></astro-island></body></html>',
      );
      put(dir, "dist/assets/entry.js", entryJs);
      put(dir, "dist/assets/chunk-a.js", chunkA);
      put(dir, "dist/shared.js", shared);
      put(dir, "dist/side.js", side);
      put(dir, "dist/reexp.js", reexp);
      put(dir, "dist/solo1.js", solo1);
      put(dir, "dist/solo2.js", solo2);
      put(dir, "dist/lazy.js", "export const hugeLazy = 1;");

      const report = await runBytesGate(
        dir,
        configFrom('protocol: "0.3.0"\nversion: "1"\npackage: site\nclass: astro-site\n'),
      );
      expect(report.passed).toBe(true);
      const pages = readBytesReport(dir);
      expect(pages).toHaveLength(2);
      const parts = [inline1, inline2, chunkA, entryJs, reexp, shared, side, solo1, solo2];
      const expectedSum = parts.reduce((sum, text) => sum + brotliBytes(text), 0);
      expect(pages[0]).toMatchObject({
        hasIsland: true,
        inlineBytes: brotliBytes(inline1) + brotliBytes(inline2),
        moduleBytes: expectedSum - brotliBytes(inline1) - brotliBytes(inline2),
        totalBytes: expectedSum,
        modules: [
          "assets/chunk-a.js",
          "assets/entry.js",
          "reexp.js",
          "shared.js",
          "side.js",
          "solo1.js",
          "solo2.js",
        ],
      });
      const nodeBytes = compressWithRuntime(process.execPath, dir, parts);
      const bunBytes = compressWithRuntime("bun", dir, parts);
      expect(nodeBytes).toEqual(bunBytes);
      expect(nodeBytes.reduce((a, b) => a + b, 0)).toBe(expectedSum);
      expect(BROTLI_OPTIONS.params).toBeDefined();
    },
    REAL_TOOL_TIMEOUT,
  );

  it("memoizes compressed module sizes across reads in createBrotliCache", () => {
    let calls = 0;
    const cached = createBrotliCache(
      (buf) => {
        calls += 1;
        return buf.length * 10;
      },
      (path) => Buffer.from(path),
    );
    expect(cached("a.js")).toBe(40);
    expect(cached("a.js")).toBe(40);
    expect(cached("bb.js")).toBe(50);
    expect(calls).toBe(2);
  });

  it("fails over-budget inline or bundled JS with law W-29, page, measured bytes, and budget bytes", async () => {
    const { dir } = makeProject();
    const noisyJs = Array.from(
      { length: 60 },
      (_, i) => `window.x${String(i)}=${String(i * 977)};`,
    ).join("");
    put(
      dir,
      "dist/index.html",
      `<!doctype html><html><body><script>${noisyJs}</script></body></html>`,
    );
    put(
      dir,
      "dist/island/index.html",
      `<!doctype html><html><body><astro-island></astro-island><script>${noisyJs}</script></body></html>`,
    );
    put(dir, "dist/ok/index.html", "<!doctype html><html><body>OK</body></html>");

    const report = await runBytesGate(
      dir,
      configFrom(
        'protocol: "0.3.0"\nversion: "1"\npackage: site\nclass: astro-site\nbudgets:\n  static_page_js_bytes: 0\n  page_js_bytes: 40\n',
      ),
    );
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(1);
    const overLayer = report.layers.find((l) => l.id === "bytes");
    if (overLayer === undefined) throw new Error("missing bytes layer");
    expect(overLayer.findings.map((f) => [f.verdict, f.law])).toEqual([
      ["fail", "W-29"],
      ["fail", "W-29"],
      ["pass", "W-29"],
    ]);
    expect(overLayer.findings[0]?.message).toContain("exceeds budget 0 B");
    expect(overLayer.findings[1]?.message).toContain("exceeds budget 40 B");
  });

  it("fails closed via W-29 when a referenced external script is missing", async () => {
    const missingMod = makeProject().dir;
    put(missingMod, "dist/index.html", '<script type="module" src="/missing.js"></script>');
    const report = await runBytesGate(
      missingMod,
      configFrom('protocol: "0.3.0"\nversion: "1"\npackage: site\nclass: web-app\n'),
    );
    expect(report.passed).toBe(false);
    const layer = report.layers.find((l) => l.id === "bytes");
    if (layer === undefined) throw new Error("missing bytes layer");
    expect(layer.findings).toHaveLength(1);
    expect(layer.findings[0]).toMatchObject({
      rule: "W-29",
      law: "W-29",
      verdict: "fail",
      file: "index.html",
    });
    expect(layer.findings[0]?.message).toContain("/missing.js");
  });

  it("fails closed on missing dist/, 0-page dist/ (X3), nested outDir creation, and missing JS modules", async () => {
    const missingDist = makeProject().dir;
    const r1 = await runBytesGate(
      missingDist,
      configFrom('protocol: "0.3.0"\nversion: "1"\npackage: site\nclass: astro-site\n'),
    );
    expect(r1.passed).toBe(false);
    expect(r1.layers.find((l) => l.id === "bytes")?.verdict).toBe("not-run");
    expect(existsSync(join(missingDist, ".web-tops/out/bytes/report.json"))).toBe(false);

    const zeroDist = makeProject().dir;
    put(zeroDist, "dist/app.css", "body {}");
    const zeroReport = await runBytesGate(
      zeroDist,
      configFrom('protocol: "0.3.0"\nversion: "1"\npackage: site\nclass: web-app\n'),
    );
    const zeroEntry = zeroReport.layers.find((l) => l.id === "bytes");
    if (zeroEntry === undefined) throw new Error("missing bytes layer");
    expect(zeroEntry.verdict).toBe("not-evaluated");
    expect(zeroEntry.reason).toContain("no HTML pages");
    expect(zeroEntry.artifacts).toEqual([".web-tops/out/bytes/report.json"]);
    expect(zeroEntry.findings).toHaveLength(1);
    expect(zeroEntry.findings[0]).toMatchObject({
      tool: "webtops",
      rule: "W-29",
      law: "W-29",
      verdict: "not-evaluated",
      message: "no HTML pages found in built dist/ directory",
    });
    expect(zeroReport.counts.not_evaluated).toBe(1);
    expect(zeroReport.passed).toBe(false);
    expect(readBytesReport(zeroDist)).toEqual([]);

    const nestedOut = join(zeroDist, "fresh/nested/out");
    const directCtx: LayerContext = {
      cwd: zeroDist,
      config: configFrom('protocol: "0.3.0"\nversion: "1"\npackage: site\nclass: astro-site\n'),
      base: "origin/main",
      enforce: "hard",
      env: process.env,
      exec: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
      outDir: nestedOut,
      artifacts: new Map(),
    };
    await bytesLayer.run(directCtx);
    const secondRun = await bytesLayer.run(directCtx);
    expect(secondRun.verdict).toBe("not-evaluated");
    expect(secondRun.artifacts).toEqual({ "bytes-json": join(nestedOut, "bytes", "report.json") });

    const missingDirect = await bytesLayer.run({
      ...directCtx,
      cwd: missingDist,
      outDir: join(missingDist, ".web-tops", "out"),
    });
    expect(missingDirect.verdict).toBe("fail");
    expect(missingDirect.findings[0]?.verdict).toBe("fail");
    expect(missingDirect.artifacts).toEqual({});
    expect(bytesLayer.classes).toEqual(["astro-site", "web-app"]);
    expect(bytesLayer.requires).toEqual(["build"]);
    expect(bytesLayer.produces).toEqual(["bytes-json"]);
    expect(bytesLayer.consumes).toEqual([{ artifact: "inventory", from: "build" }]);
  });

  it("extracts MIME variants, entities, quotes, comments, and closes scripts safely", () => {
    const html = [
      "<!doctype html>",
      "a<!-- <div></div> <script>x=1;</script> -->b",
      "<!--<!--><script>afterNested=1;</script>",
      `><script title="a 'b' > c" src='/e.js?q=&amp;&apos;&gt;&lt;&quot;&unknown;' src="/dup.js"></script>`,
      `<script title='a "b" > c' type=" text/javascript ; charset=utf-8" src=/unquoted.js></script>`,
      '<script type="">emptyType=1;</script>',
      '<script type="application/javascript">appJs=1;</script>',
      '<script type="application/ecmascript">appEcma=1;</script>',
      '<script type="text/ecmascript">textEcma=1;</script>',
      "</script src='/ignore-close.js'>",
      '<link href="/no-rel.css"><link rel="stylesheet" href="/app.css"><link rel="modulepreload"><a rel="modulepreload" href="/not-link.js">',
      '<link rel="preload modulepreload" href="/pre.js">',
      '<div id="" disabled>5 < 6</div>',
      "<SCRIPT >upperScript=1;</SCRIPT ><script>unclosedAtEof=1;",
    ].join("\n");
    const extracted = extractPageScripts(html);
    expect(extracted.externalRefs).toEqual([
      { line: 4, target: "/e.js?q=&'><\"&unknown;" },
      { line: 5, target: "/unquoted.js" },
      { line: 12, target: "/pre.js" },
    ]);
    expect(extracted.inlineBodies).toEqual([
      "afterNested=1;",
      "emptyType=1;",
      "appJs=1;",
      "appEcma=1;",
      "textEcma=1;",
      "upperScript=1;",
      "unclosedAtEof=1;",
    ]);
    expect(extractPageScripts("<!---><script>insideBoundary=1;</script>").inlineBodies).toEqual([]);
    expect(extractPageScripts("<!-- <script>unclosed=1;</script>").inlineBodies).toEqual([]);
    expect(extractPageScripts('<span title="unclosed"').inlineBodies).toEqual([]);
    expect(extractPageScripts("x<script>first=1;</script>").inlineBodies).toEqual(["first=1;"]);
  });

  it("handles static closure error paths (missing script, relative/inline escape, bad URI)", () => {
    const { dir } = makeProject();
    const distDir = join(dir, "dist");
    put(dir, "dist/sub/ok.js", 'import "../miss-dep.js";');
    expect(
      resolvePageModuleClosure(
        distDir,
        new Set(["sub/ok.js"]),
        "index.html",
        [],
        [{ target: "/bad%E0%A4%A.js" }],
      ),
    ).toEqual({
      ok: false,
      reason: 'missing JS module "/bad%E0%A4%A.js" referenced from index.html',
    });
    expect(
      resolvePageModuleClosure(
        distDir,
        new Set(["sub/ok.js"]),
        "index.html",
        [],
        [{ target: "?v=1" }],
      ),
    ).toEqual({ ok: false, reason: 'missing JS module "?v=1" referenced from index.html' });
    expect(
      resolvePageModuleClosure(
        distDir,
        new Set(["sub/ok.js"]),
        "index.html",
        ['import "./miss-inline.js";'],
        [],
      ),
    ).toEqual({
      ok: false,
      reason: 'missing JS module "./miss-inline.js" referenced from index.html',
    });
    expect(
      resolvePageModuleClosure(
        distDir,
        new Set(["sub/ok.js"]),
        "index.html",
        [],
        [{ target: "sub/ok.js" }],
      ),
    ).toEqual({
      ok: false,
      reason: 'missing JS module "../miss-dep.js" referenced from sub/ok.js',
    });
    expect(
      resolvePageModuleClosure(
        distDir,
        new Set(["sub/ok.js"]),
        "index.html",
        [],
        [{ target: "../outside.js" }],
      ),
    ).toEqual({
      ok: false,
      reason: 'missing JS module "../outside.js" referenced from index.html',
    });
    expect(
      resolvePageModuleClosure(
        distDir,
        new Set(["sub/ok.js"]),
        "index.html",
        [],
        [{ target: "sub/v1:colon.js" }],
      ),
    ).toEqual({
      ok: false,
      reason: 'missing JS module "sub/v1:colon.js" referenced from index.html',
    });
    expect(extractStaticImports('const x = <a>b; import "./js-mode.js";')).toEqual([]);
    expect(extractStaticImports('import "./a.js"; export * from "./b.js"; export { x };')).toEqual([
      "./a.js",
      "./b.js",
    ]);
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
