import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { Agent, request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../config/validate.ts";
import { readBaseline } from "../../baseline/read.ts";
import { toGateConfig } from "../../gate/adapter.ts";
import { realExec } from "../../gate/exec.ts";
import { runGate, type RunInput } from "../../gate/runner.ts";
import { cfg, opts, tempProject, tickingClock } from "../../gate/testkit.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import type { Exec, GateConfig, Layer, LayerContext } from "../../gate/types.ts";
import { checkTargetPath, type ResolveDistResult } from "./inventory.ts";
import type { BuildRunResult } from "./run.ts";
import {
  acceptsBrotli,
  handleRequest,
  listenStaticServer,
  type BindableServer,
  type StaticResponse,
} from "./server.ts";
import {
  BROTLI_OPTIONS,
  buildLayer,
  ensureBuild,
  ensureServer,
  mimeType,
  readInventoryArtifact,
  resolveDistDir,
  routeForHtml,
  scanDist,
  startStaticServer,
  type DistInventory,
} from "./index.ts";

function expectDistFail(result: ResolveDistResult, substring: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toContain(substring);
}

function expectBuildFail(
  result: BuildRunResult | undefined,
  rule: string,
  substring: string,
): void {
  if (result === undefined || result.ok) {
    expect.unreachable("expected failed build result");
  }
  expect(result.findings[0]).toMatchObject({ rule });
  expect(result.reason).toContain(substring);
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
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

interface HttpReply {
  readonly status: number | undefined;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Buffer;
}

function requestRaw(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    agent?: Agent;
    rawPath?: string;
  } = {},
): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: options.rawPath ?? parsed.pathname + parsed.search,
        method: options.method ?? "GET",
        headers: options.headers,
        agent: options.agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function runWith(layers: readonly Layer[], config: GateConfig, cwd: string, exec: Exec) {
  return runGate({
    layers,
    config,
    options: opts(),
    cwd,
    env: process.env,
    exec,
    outDir: join(cwd, ".web-tops", "out"),
    now: tickingClock(),
  });
}

interface SeenArtifact {
  readonly id: string;
  readonly manifest: string | undefined;
  readonly inv: DistInventory | undefined;
}

function assertSharedSeen(dir: string, seen: readonly SeenArtifact[]): void {
  expect(seen).toHaveLength(2);
  const first = seen[0];
  const second = seen[1];
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  if (first === undefined || second === undefined) return;
  expect(first.manifest).toBe(join(dir, ".web-tops/out/build/inventory.json"));
  expect(second.manifest).toBe(first.manifest);
  expect(first.inv?.pages.map((p) => p.route)).toEqual(["/about/", "/"]);
  expect(second.inv).toEqual(first.inv);
}

function consumerLayer(id: string, seen: SeenArtifact[]): Layer {
  return {
    id,
    gate: 6,
    tier: 1,
    classes: ["astro-site"],
    requires: ["build"],
    produces: [],
    consumes: [{ artifact: "inventory", from: "build" }],
    run: async (context) => {
      const res = await ensureBuild(context);
      seen.push({
        id,
        manifest: context.artifacts.get("inventory"),
        inv: res.ok ? res.inventory : undefined,
      });
      return { verdict: res.ok ? "pass" : "fail", findings: [], artifacts: {} };
    },
  };
}

function ensureBuildLayer(id: string): Layer {
  return {
    id,
    gate: 6,
    tier: 1,
    classes: ["web-app"],
    requires: [],
    produces: [],
    consumes: [],
    run: async (context) => {
      const built = await ensureBuild(context);
      return { verdict: built.ok ? "pass" : "fail", findings: [], artifacts: {} };
    },
  };
}

async function fetchThroughServer(
  context: LayerContext,
  agent: Agent,
  origins: string[],
  shouldThrow: boolean,
): Promise<{ verdict: "pass" | "fail"; findings: []; artifacts: Record<string, string> }> {
  const res = await ensureBuild(context);
  expect(res.ok).toBe(true);
  if (!res.ok) return { verdict: "fail", findings: [], artifacts: {} };
  const server = await ensureServer(context, res.inventory.distDir);
  origins.push(server.origin);
  const reply = await requestRaw(`${server.origin}/`, { agent });
  expect(reply.status).toBe(200);
  if (shouldThrow) throw new Error("downstream boom");
  return { verdict: "pass", findings: [], artifacts: {} };
}

describe("M4 G1: dist page inventory and path validation", () => {
  it("maps nested HTML files to deterministic routes and byte counts", () => {
    const { dir } = makeProject();
    put(dir, "dist/z.html", "<!doctype html><h1>Z</h1>");
    put(dir, "dist/index.html", "<!doctype html><h1>Home</h1>");
    put(dir, "dist/docs/index.html", "<!doctype html><h1>Docs</h1>");
    put(dir, "dist/a/sub.html", "<!doctype html><h1>Sub</h1>");
    put(dir, "dist/a-file.html", "<!doctype html><h1>Dash</h1>");
    put(dir, "dist/404.html", "<!doctype html><h1>Missing</h1>");
    put(dir, "dist/assets/app.js", "console.log(1);\n");
    const outside = put(dir, "outside.html", "<p>secret</p>");
    symlinkSync(outside, join(dir, "dist/escape.html"));

    expect(buildLayer.classes).toEqual(["ui-components", "astro-site", "web-app"]);
    expect(buildLayer.requires).toEqual([]);
    expect(buildLayer.produces).toEqual(["inventory"]);

    const resolved = resolveDistDir(dir);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const inv = scanDist(resolved.dir);
    expect(inv.pages.map((p) => [p.file, p.route])).toEqual([
      ["404.html", "/404.html"],
      ["a-file.html", "/a-file.html"],
      ["a/sub.html", "/a/sub.html"],
      ["docs/index.html", "/docs/"],
      ["index.html", "/"],
      ["z.html", "/z.html"],
    ]);
    expect(inv.files).toEqual([
      "404.html",
      "a-file.html",
      "a/sub.html",
      "assets/app.js",
      "docs/index.html",
      "index.html",
      "z.html",
    ]);
    expect(routeForHtml("a/b/c.html")).toBe("/a/b/c.html");
  });

  it("rejects missing, non-directory, empty, self, absolute, and escaping build paths", () => {
    const { dir } = makeProject();
    const failWith = (sub: string | undefined, expected: string) => {
      expectDistFail(resolveDistDir(dir, sub), expected);
    };
    expect(checkTargetPath(dir)).toEqual({ ok: true, dir: join(dir, "dist") });
    failWith(undefined, "is missing");
    for (const bad of ["", "   ", "/tmp"]) failWith(bad, "must be a relative path");
    for (const esc of [".", "../outside"]) failWith(esc, "escapes project root");
    symlinkSync(makeProject().dir, join(dir, "linked-out"));
    failWith("linked-out", "resolves outside project root");
    put(dir, "dist", "not a directory");
    failWith("dist", "is not a directory");
    mkdirSync(join(dir, "out"));
    expect(resolveDistDir(dir, "  out  ").ok).toBe(true);
  });

  it("resolves default build dir without command in toGateConfig", () => {
    const parsed = parseConfig(
      'protocol: "0.3.0"\nversion: "1.0.0"\npackage: p\nclass: web-app\nenforce: hard\nbuild: {}\n',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const gateCfg = toGateConfig(parsed.value, { dependsOnAstro: false });
    expect(gateCfg.build).toEqual({ dir: "dist" });
    expect("command" in (gateCfg.build ?? {})).toBe(false);
  });
});

describe("M4 G1: shared single build across two downstream layers (N5)", () => {
  it("runs build command exactly once when buildLayer hands inventory to two downstream consumers", async () => {
    const { dir } = makeProject();
    const seen: SeenArtifact[] = [];
    let execCount = 0;

    const fakeBuildExec: Exec = () => {
      execCount += 1;
      put(dir, "custom-dist/index.html", "<!doctype html><title>App</title>");
      put(dir, "custom-dist/about/index.html", "<!doctype html><title>About</title>");
      return Promise.resolve({ code: 0, stdout: "built\n", stderr: "" });
    };

    const parsed = parseConfig(
      'protocol: "0.3.0"\nversion: "1.0.0"\npackage: app\nclass: astro-site\nbuild:\n  command: "bun run build"\n  dir: custom-dist\n',
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    const gateConfig = toGateConfig(parsed.value, { dependsOnAstro: true });

    const report = await runWith(
      [buildLayer, consumerLayer("html-check", seen), consumerLayer("link-check", seen)],
      gateConfig,
      dir,
      fakeBuildExec,
    );

    expect(report.passed).toBe(true);
    expect(execCount).toBe(1);
    assertSharedSeen(dir, seen);
  });

  it(
    "deduplicates concurrent/sequential ensureBuild calls with a real process (process count = 1)",
    async () => {
      const { dir } = makeProject();
      const countFile = join(dir, "build-count.log");
      const cmd = `printf "1\\n" >> "${countFile}" && mkdir -p dist && printf "<h1>Hi</h1>" > dist/index.html`;
      const gateConfig = cfg({ class: "web-app", build: { command: cmd, dir: "dist" } });

      const report = await runWith(
        [ensureBuildLayer("downstream-a"), ensureBuildLayer("downstream-b")],
        gateConfig,
        dir,
        (command, args, options) =>
          realExec(command, args, { ...options, timeoutMs: REAL_TOOL_TIMEOUT }),
      );
      expect(report.passed).toBe(true);
      expect(readFileSync(countFile, "utf8").trim().split("\n")).toHaveLength(1);
      expect(existsSync(join(dir, ".web-tops/out/build/inventory.json"))).toBe(true);
    },
    REAL_TOOL_TIMEOUT,
  );
});

describe("M4 G1: fail-closed build and inventory guards", () => {
  it("fails closed when dist/ is missing and blocks downstream consumers as not-run", async () => {
    const { dir } = makeProject();
    const gateConfig = cfg({ class: "astro-site" });
    let ranDownstream = false;
    const downstream: Layer = {
      id: "downstream",
      gate: 6,
      tier: 1,
      classes: ["astro-site"],
      requires: ["build"],
      produces: [],
      consumes: [{ artifact: "inventory", from: "build" }],
      run: () => {
        ranDownstream = true;
        return Promise.resolve({ verdict: "pass", findings: [], artifacts: {} });
      },
    };
    const report = await runWith([buildLayer, downstream], gateConfig, dir, () =>
      Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    );
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(1);
    expect(ranDownstream).toBe(false);
    expect(report.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "build",
          verdict: "fail",
          findings: [expect.objectContaining({ rule: "build-missing-dist" })],
        }),
        expect.objectContaining({ id: "downstream", verdict: "not-run" }),
      ]),
    );
    expect(existsSync(join(dir, ".web-tops/out/build/inventory.json"))).toBe(false);
  });

  it.each([
    ["exits non-zero with stderr", { code: 2, stdout: "", stderr: "  boom  " }, "exit 2: boom)"],
    [
      "exits non-zero with multi-line stdout",
      { code: 1, stdout: "l1\nl2\nl3\nl4\n", stderr: "  \n  " },
      "exit 1: l2 | l3 | l4)",
    ],
    ["exits null without output", { code: null, stdout: "", stderr: "" }, "(exit null)"],
    [
      "times out",
      { code: null, stdout: "", stderr: "", failure: "tool-timeout" as const },
      "(tool-timeout)",
    ],
    [
      "reports failure even when code is 0",
      { code: 0, stdout: "", stderr: "", failure: "tool-timeout" as const },
      "(tool-timeout)",
    ],
  ])("fails closed when build command %s", async (_what, result, expected) => {
    const { dir } = makeProject();
    put(dir, "dist/index.html", "<h1>stale</h1>");
    const gateConfig = cfg({ class: "astro-site", build: { command: "astro build", dir: "dist" } });
    const report = await runWith([buildLayer], gateConfig, dir, () => Promise.resolve(result));
    expect(report.passed).toBe(false);
    const buildEntry = report.layers.find((l) => l.id === "build");
    expect(buildEntry?.findings[0]?.rule).toBe("build-command");
    expect(buildEntry?.findings.map((f) => f.message).join("\n")).toContain(expected);
  });

  it("fails closed with build-path and build-artifact for invalid dir or unreadable handoff", async () => {
    const { dir } = makeProject();
    const badPath = await runWith(
      [buildLayer],
      cfg({ class: "web-app", build: { dir: "../bad" } }),
      dir,
      () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    );
    expect(badPath.passed).toBe(false);
    expect(badPath.layers).toEqual([
      expect.objectContaining({
        id: "build",
        findings: [expect.objectContaining({ rule: "build-path" })],
      }),
    ]);

    const handoffLayer: Layer = {
      id: "bad-handoff",
      gate: 6,
      tier: 1,
      classes: ["web-app"],
      requires: [],
      produces: ["inventory"],
      consumes: [],
      run: () =>
        Promise.resolve({
          verdict: "pass",
          findings: [],
          artifacts: {
            inventory: put(dir, ".web-tops/out/bad-handoff/corrupt-inventory.json", "{not json"),
          },
        }),
    };
    let handedResult: Awaited<ReturnType<typeof ensureBuild>> | undefined;
    const readerLayer: Layer = {
      id: "reader",
      gate: 6,
      tier: 1,
      classes: ["web-app"],
      requires: ["bad-handoff"],
      produces: [],
      consumes: [{ artifact: "inventory", from: "bad-handoff" }],
      run: async (context) => {
        handedResult = await ensureBuild(context);
        return { verdict: "pass", findings: [], artifacts: {} };
      },
    };
    await runWith([handoffLayer, readerLayer], cfg({ class: "web-app" }), dir, () =>
      Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    );
    expectBuildFail(handedResult, "build-artifact", "handed-off build inventory");
  });

  it("rejects unreadable or malformed inventory artifacts", () => {
    const { dir } = makeProject();
    expect(readInventoryArtifact(join(dir, "missing.json"))).toBeUndefined();
    const file = put(dir, "bad.json", "{not json");
    expect(readInventoryArtifact(file)).toBeUndefined();
    for (const payload of [
      null,
      [],
      123,
      { version: 2, distDir: "x", pages: [], files: [] },
      { version: 1, distDir: 1, pages: [], files: [] },
      { version: 1, distDir: "x", pages: "bad", files: [] },
      { version: 1, distDir: "x", pages: [null], files: [] },
      { version: 1, distDir: "x", pages: [[]], files: [] },
      { version: 1, distDir: "x", pages: [{ file: 1, route: "/", bytes: 0 }], files: [] },
      { version: 1, distDir: "x", pages: [{ file: "a", route: 1, bytes: 0 }], files: [] },
      { version: 1, distDir: "x", pages: [{ file: "a", route: "/", bytes: "0" }], files: [] },
      { version: 1, distDir: "x", pages: [], files: "bad" },
      { version: 1, distDir: "x", pages: [], files: [123] },
    ]) {
      writeFileSync(file, JSON.stringify(payload));
      expect(readInventoryArtifact(file)).toBeUndefined();
    }
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        distDir: "dist",
        pages: [{ file: "index.html", route: "/", bytes: 5 }],
        files: ["index.html"],
      }),
    );
    expect(readInventoryArtifact(file)?.distDir).toBe("dist");
  });
});

describe("M4 G1: static server on 127.0.0.1:0 with fixed brotli and deterministic teardown", () => {
  it("serves dist/ routes, MIME types, fixed brotli (q11/w22), and blocks traversal", async () => {
    const { dir } = makeProject();
    const indexHtml = "<!doctype html><html><body><h1>Static Serve</h1></body></html>";
    const appJs = "export const hello = () => 'world';\n";
    put(dir, "dist/index.html", indexHtml);
    put(dir, "dist/docs/index.html", "<h1>Docs</h1>");
    put(dir, "dist/about.html", "<h1>About</h1>");
    put(dir, "dist/assets/app.js", appJs);
    const secret = put(dir, "secret.txt", "top secret");
    symlinkSync(secret, join(dir, "dist/leak.txt"));

    const server = await startStaticServer(join(dir, "dist"));
    cleanups.push(server.close);
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const plain = await requestRaw(`${server.origin}/`, {
      headers: { "accept-encoding": "identity" },
    });
    expect(plain.status).toBe(200);
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body.toString("utf8")).toBe(indexHtml);

    const brReply = await requestRaw(`${server.origin}/assets/app.js`, {
      headers: { "accept-encoding": "gzip, br" },
    });
    expect(brReply.status).toBe(200);
    expect(brReply.headers["content-encoding"]).toBe("br");
    expect(brReply.headers["vary"]).toBe("Accept-Encoding");
    expect(brReply.body.equals(brotliCompressSync(Buffer.from(appJs), BROTLI_OPTIONS))).toBe(true);
    expect(brotliDecompressSync(brReply.body).toString("utf8")).toBe(appJs);

    expect(plain.headers["cache-control"]).toBe("no-store");
    expect((await requestRaw(`${server.origin}/docs?q=1`)).status).toBe(200);
    expect((await requestRaw(`${server.origin}//docs//`)).status).toBe(200);
    expect((await requestRaw(`${server.origin}/about`)).status).toBe(200);
    const head = await requestRaw(`${server.origin}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(indexHtml)));

    const notFound = await requestRaw(`${server.origin}/missing.txt`);
    expect(notFound.status).toBe(404);
    expect(notFound.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect((await requestRaw(`${server.origin}/leak.txt`)).status).toBe(404);
    expect((await requestRaw(server.origin, { rawPath: "/%2e%2e/secret.txt" })).status).toBe(400);
    expect((await requestRaw(server.origin, { rawPath: "/./about.html" })).status).toBe(400);
    expect((await requestRaw(server.origin, { rawPath: "/../secret.txt" })).status).toBe(400);
    expect((await requestRaw(server.origin, { rawPath: "/%ff" })).status).toBe(400);
    expect((await requestRaw(`${server.origin}/../secret.txt`)).status).toBe(404);
    const notAllowed = await requestRaw(`${server.origin}/`, { method: "POST" });
    expect(notAllowed.status).toBe(405);
    expect(notAllowed.body.toString("utf8")).toBe("Method Not Allowed");

    expect(acceptsBrotli(undefined)).toBe(false);
    expect(acceptsBrotli("gzip, deflate")).toBe(false);
    expect(acceptsBrotli("br;q=0")).toBe(false);
    expect(acceptsBrotli("br; q=0")).toBe(false);
    expect(acceptsBrotli("br; q=0.5")).toBe(true);
    expect(acceptsBrotli(["gzip", "br"])).toBe(true);
    const expectedMimes: readonly [string, string][] = [
      ["a.html", "text/html; charset=utf-8"],
      ["A.HTML", "text/html; charset=utf-8"],
      ["a.js", "text/javascript; charset=utf-8"],
      ["a.mjs", "text/javascript; charset=utf-8"],
      ["a.css", "text/css; charset=utf-8"],
      ["a.json", "application/json; charset=utf-8"],
      ["a.svg", "image/svg+xml"],
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.jpeg", "image/jpeg"],
      ["a.webp", "image/webp"],
      ["a.woff2", "font/woff2"],
      ["a.wasm", "application/wasm"],
      ["a.txt", "text/plain; charset=utf-8"],
      ["a.xml", "application/xml; charset=utf-8"],
      ["file.unknown", "application/octet-stream"],
    ];
    for (const [extFile, mime] of expectedMimes) {
      expect(mimeType(extFile), extFile).toBe(mime);
    }
  });

  it("drains cleanups in LIFO order once per gate run", async () => {
    const { dir } = makeProject();
    const order: string[] = [];
    let register = true;
    const cleanupLayer: Layer = {
      id: "clean",
      gate: 6,
      tier: 1,
      classes: ["web-app"],
      requires: [],
      produces: [],
      consumes: [],
      run: (context) => {
        if (register) {
          context.onCleanup?.(() => {
            order.push("first");
            return Promise.resolve();
          });
          context.onCleanup?.(() => {
            order.push("second");
            return Promise.resolve();
          });
        }
        return Promise.resolve({ verdict: "pass", findings: [], artifacts: {} });
      },
    };
    const input: RunInput = {
      layers: [cleanupLayer],
      config: cfg({ class: "web-app" }),
      options: opts(),
      cwd: dir,
      env: process.env,
      exec: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
      outDir: join(dir, ".web-tops", "out"),
      now: tickingClock(),
    };
    await runGate(input);
    expect(order).toEqual(["second", "first"]);
    register = false;
    await runGate(input);
    expect(order).toEqual(["second", "first"]);
  });

  it("shares one static server across downstream layers and tears down sockets even if a layer throws", async () => {
    const { dir } = makeProject();
    put(dir, "dist/index.html", "<h1>Keep-Alive Test</h1>");
    const agent = new Agent({ keepAlive: true });
    cleanups.push(() => {
      agent.destroy();
    });

    const origins: string[] = [];
    const layerUse = (id: string, shouldThrow: boolean): Layer => ({
      id,
      gate: 6,
      tier: 1,
      classes: ["web-app"],
      requires: ["build"],
      produces: [],
      consumes: [{ artifact: "inventory", from: "build" }],
      run: (context) => fetchThroughServer(context, agent, origins, shouldThrow),
    });

    const report = await runWith(
      [buildLayer, layerUse("s1", false), layerUse("s2", true)],
      cfg({ class: "web-app" }),
      dir,
      () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    );
    expect(report.passed).toBe(false);
    expect(origins).toHaveLength(2);
    expect(origins[0]).toBe(origins[1]);
    await expect(requestRaw(`${origins[0] ?? ""}/`)).rejects.toThrow();
  });

  it("falls back to GET / in handleRequest and force-closes idle sockets on server.close()", async () => {
    const { dir } = makeProject();
    put(dir, "dist/index.html", "<h1>Fallback</h1>");
    let statusCode = 0;
    let endedBody = "";
    const fakeRes: StaticResponse = {
      writeHead: (code) => {
        statusCode = code;
      },
      end: (chunk) => {
        endedBody = chunk === undefined ? "" : String(chunk);
      },
    };
    handleRequest(realpathSync(join(dir, "dist")), { headers: {} }, fakeRes);
    expect(statusCode).toBe(200);
    expect(endedBody).toBe("<h1>Fallback</h1>");

    const server = await startStaticServer(join(dir, "dist"));
    const sock = createConnection({ host: "127.0.0.1", port: server.port });
    cleanups.push(() => {
      sock.destroy();
    });
    await new Promise<void>((resolve) => {
      sock.once("connect", () => {
        sock.write("GET / HTTP/1.1\r\n");
        resolve();
      });
    });
    await Promise.race([
      server.close(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("close timeout"));
        }, 250);
      }),
    ]);

    expect(readBaseline(dir, "none.json")).toEqual({
      ok: false,
      reason: "none.json cannot be read: the baseline is missing",
      missing: true,
    });
    mkdirSync(join(dir, "subdir"));
    expect(readBaseline(dir, "subdir")).toEqual({
      ok: false,
      reason: "subdir cannot be read",
    });
  });

  it("fails closed when listenStaticServer emits error or binds non-TCP address", async () => {
    let onErr: ((err: Error) => void) | undefined;
    const errServer: BindableServer = {
      once: (_ev, fn) => {
        onErr = fn;
      },
      listen: () => {
        onErr?.(new Error("EADDRINUSE"));
      },
      address: () => null,
      close: (cb) => {
        cb();
      },
      closeAllConnections: () => {},
    };
    await expect(listenStaticServer(errServer)).rejects.toThrow("EADDRINUSE");

    let closed = false;
    let closedAll = false;
    const nullAddrServer: BindableServer = {
      once: () => {},
      listen: (_p, _h, cb) => {
        cb();
      },
      address: () => null,
      close: (cb) => {
        closed = true;
        cb();
      },
      closeAllConnections: () => {
        closedAll = true;
      },
    };
    await expect(listenStaticServer(nullAddrServer)).rejects.toThrow(
      "failed to bind ephemeral loopback port",
    );
    expect(closed).toBe(true);
    expect(closedAll).toBe(true);
  });
});
