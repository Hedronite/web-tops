import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { Agent, request as httpRequest } from "node:http";
import { dirname, join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../../config/validate.ts";
import { toGateConfig } from "../../gate/adapter.ts";
import { realExec } from "../../gate/exec.ts";
import { runGate } from "../../gate/runner.ts";
import { cfg, opts, tempProject, tickingClock } from "../../gate/testkit.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import type { Exec, GateConfig, Layer, LayerContext } from "../../gate/types.ts";
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
    put(dir, "dist/index.html", "<!doctype html><h1>Home</h1>");
    put(dir, "dist/docs/index.html", "<!doctype html><h1>Docs</h1>");
    put(dir, "dist/404.html", "<!doctype html><h1>Missing</h1>");
    put(dir, "dist/assets/app.js", "console.log(1);\n");
    const outside = put(dir, "outside.html", "<p>secret</p>");
    symlinkSync(outside, join(dir, "dist/escape.html"));

    const resolved = resolveDistDir(dir, "dist");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const inv = scanDist(resolved.dir);
    expect(inv.pages.map((p) => [p.file, p.route])).toEqual([
      ["404.html", "/404.html"],
      ["docs/index.html", "/docs/"],
      ["index.html", "/"],
    ]);
    expect(inv.files).toEqual(["404.html", "assets/app.js", "docs/index.html", "index.html"]);
    expect(routeForHtml("a/b/c.html")).toBe("/a/b/c.html");
  });

  it("rejects missing, non-directory, absolute, and parent-escaping build paths", () => {
    const { dir } = makeProject();
    expect(resolveDistDir(dir, "dist").ok).toBe(false);
    put(dir, "dist", "not a directory");
    expect(resolveDistDir(dir, "dist").ok).toBe(false);
    expect(resolveDistDir(dir, "/tmp").ok).toBe(false);
    expect(resolveDistDir(dir, "../outside").ok).toBe(false);
    const external = makeProject().dir;
    symlinkSync(external, join(dir, "linked-out"));
    expect(resolveDistDir(dir, "linked-out").ok).toBe(false);
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
    expect(report.layers.find((l) => l.id === "build")?.verdict).toBe("fail");
    expect(report.layers.find((l) => l.id === "downstream")?.verdict).toBe("not-run");
    expect(existsSync(join(dir, ".web-tops/out/build/inventory.json"))).toBe(false);
  });

  it.each([
    ["exits non-zero", { code: 2, stdout: "", stderr: "boom" }, "boom"],
    [
      "times out",
      { code: null, stdout: "", stderr: "", failure: "tool-timeout" as const },
      "tool-timeout",
    ],
  ])("fails closed when build command %s", async (_what, result, expected) => {
    const { dir } = makeProject();
    put(dir, "dist/index.html", "<h1>stale</h1>");
    const gateConfig = cfg({ class: "astro-site", build: { command: "astro build", dir: "dist" } });
    const report = await runWith([buildLayer], gateConfig, dir, () => Promise.resolve(result));
    expect(report.passed).toBe(false);
    const buildEntry = report.layers.find((l) => l.id === "build");
    expect(buildEntry?.findings.map((f) => f.message).join("\n")).toContain(expected);
  });

  it("rejects unreadable or malformed inventory artifacts", () => {
    const { dir } = makeProject();
    expect(readInventoryArtifact(join(dir, "missing.json"))).toBeUndefined();
    const bad = put(dir, "bad.json", "{not json");
    expect(readInventoryArtifact(bad)).toBeUndefined();
    const wrong = put(
      dir,
      "wrong.json",
      JSON.stringify({ version: 2, distDir: "x", pages: [], files: [] }),
    );
    expect(readInventoryArtifact(wrong)).toBeUndefined();
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

    expect((await requestRaw(`${server.origin}/docs`)).status).toBe(200);
    expect((await requestRaw(`${server.origin}/about`)).status).toBe(200);
    const head = await requestRaw(`${server.origin}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);

    expect((await requestRaw(`${server.origin}/missing.txt`)).status).toBe(404);
    expect((await requestRaw(`${server.origin}/leak.txt`)).status).toBe(404);
    expect((await requestRaw(server.origin, { rawPath: "/%2e%2e/secret.txt" })).status).toBe(400);
    expect((await requestRaw(server.origin, { rawPath: "/../secret.txt" })).status).toBe(400);
    expect((await requestRaw(`${server.origin}/../secret.txt`)).status).toBe(404);
    expect((await requestRaw(`${server.origin}/`, { method: "POST" })).status).toBe(405);
    expect(mimeType("file.unknown")).toBe("application/octet-stream");
  });

  it("rejects non-directory dist targets and malformed inventory artifacts", () => {
    const { dir } = makeProject();
    put(dir, "dist", "not a directory");
    expect(resolveDistDir(dir, "dist").ok).toBe(false);

    const artifact = put(
      dir,
      "bad.json",
      JSON.stringify({ version: 1, distDir: "x", pages: "bad", files: [] }),
    );
    expect(readInventoryArtifact(artifact)).toBeUndefined();
    writeFileSync(artifact, JSON.stringify({ version: 1, distDir: "x", pages: [{}], files: [] }));
    expect(readInventoryArtifact(artifact)).toBeUndefined();
    writeFileSync(artifact, JSON.stringify({ version: 1, distDir: "x", pages: [], files: [123] }));
    expect(readInventoryArtifact(artifact)).toBeUndefined();
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
});
