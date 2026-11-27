import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import { cfg, tempProject } from "../../gate/testkit.ts";
import type { BudgetsSettings, Exec, LayerContext, LayerResult } from "../../gate/types.ts";
import { buildLayer } from "../build/index.ts";
import { brotliBytes } from "../bytes/index.ts";
import { routeBytesLayer } from "./index.ts";
import { routeBudget } from "./measure.ts";
import { PLAYWRIGHT, ROUTE_TIMEOUT_MS } from "./run.ts";

const KIT = resolve(import.meta.dirname, "../../..");
/** A Chromium run kills no mutant a stand-in driver does not, and is far too slow to repeat for each one (R112). */
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;
const made: (() => void)[] = [];
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const cleanup of made.splice(0)) cleanup();
});

function put(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

/** A project with `files` and, unless told otherwise, the kit's Playwright linked into its node_modules. */
function project(files: Readonly<Record<string, string>>, installed = true): string {
  const temp = tempProject();
  made.push(temp.cleanup);
  mkdirSync(join(temp.dir, "node_modules", "@playwright"), { recursive: true });
  if (installed) {
    symlinkSync(
      join(KIT, "node_modules", PLAYWRIGHT()),
      join(temp.dir, "node_modules", PLAYWRIGHT()),
    );
  }
  put(temp.dir, { "package.json": '{ "name": "app", "type": "module" }\n', ...files });
  return temp.dir;
}

interface Setup {
  readonly routes?: readonly string[];
  readonly budgets?: BudgetsSettings;
}

const config = (setup: Setup): LayerContext["config"] => cfg({ class: "web-app", ...setup });

function contextFor(dir: string, setup: Setup, over: Partial<LayerContext> = {}): LayerContext {
  return {
    cwd: dir,
    config: config(setup),
    base: "origin/main",
    enforce: "hard",
    env: process.env,
    exec: realExec,
    outDir: join(dir, ".web-tops", "out"),
    artifacts: new Map(),
    runCache: new Map(),
    onCleanup: (close) => {
      closers.push(close);
    },
    ...over,
  };
}

/** The context as the runner gives it to the layer: the build layer has run and handed its inventory over. */
async function built(
  dir: string,
  setup: Setup,
  over: Partial<LayerContext> = {},
): Promise<LayerContext> {
  const context = contextFor(dir, setup, over);
  const result = await buildLayer.run(context);
  return { ...context, artifacts: new Map(Object.entries(result.artifacts)) };
}

const page = (head: string): string =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>App</title>` +
  `<link rel="icon" href="data:,">${head}</head><body><main><h1>App</h1></main></body></html>`;

const INLINE = 'window.booted = "yes";';
const SHELL = page(
  `<script>${INLINE}</script><script type="application/json">{"data":"never run"}</script>` +
    '<link rel="modulepreload" href="/assets/preloaded.js">' +
    '<script type="module" src="/assets/main.js"></script>',
);

const filler = (name: string, lines: number): string =>
  Array.from(
    { length: lines },
    (_, i) => `export const ${name}${String(i)} = "${name}-${String(i * 7919)}";`,
  ).join("\n");

/** One entry for every route, with a lazy chunk per route and one that only a click asks for. */
const APP = {
  "dist/index.html": SHELL,
  "dist/about.html": SHELL,
  "dist/assets/main.js":
    'import "./shared.js";\n' +
    'if (location.pathname === "/") await import("./home.js");\n' +
    'if (location.pathname === "/about") await import("./about.js");\n' +
    'document.body.addEventListener("click", () => import("./on-click.js"));\n',
  "dist/assets/shared.js": filler("shared", 5),
  "dist/assets/preloaded.js": filler("preloaded", 3),
  "dist/assets/home.js": filler("home", 400),
  "dist/assets/about.js": filler("about", 4),
  "dist/assets/on-click.js": filler("click", 900),
};

const sizeOf = (...names: readonly (keyof typeof APP)[]): number =>
  names.reduce((total, name) => total + brotliBytes(APP[name]), 0);

const COMMON = [
  "dist/assets/main.js",
  "dist/assets/preloaded.js",
  "dist/assets/shared.js",
] as const;
const HOME_BYTES = (): number => brotliBytes(INLINE) + sizeOf(...COMMON, "dist/assets/home.js");
const ABOUT_BYTES = (): number => brotliBytes(INLINE) + sizeOf(...COMMON, "dist/assets/about.js");

const reportOf = (result: LayerResult): unknown =>
  JSON.parse(readFileSync(String(result.artifacts["route-bytes-json"]), "utf8"));

const ROUTES = ["/", "/about"];

describe.skipIf(insideStryker)(
  "route bytes in headless Chromium",
  { timeout: REAL_TOOL_TIMEOUT },
  () => {
    async function run(
      setup: Setup,
      files: Readonly<Record<string, string>> = APP,
    ): Promise<LayerResult> {
      return routeBytesLayer().run(await built(project(files), setup));
    }

    it("counts what each route loads, and a lazy chunk only on the route that asked for it", async () => {
      const result = await run({ routes: ROUTES });
      expect(result.verdict).toBe("pass");
      expect(reportOf(result)).toEqual({
        routes: [
          {
            route: "/",
            inlineBytes: brotliBytes(INLINE),
            scriptBytes: HOME_BYTES() - brotliBytes(INLINE),
            totalBytes: HOME_BYTES(),
            budgetBytes: 174_080,
            scripts: [
              "assets/home.js",
              "assets/main.js",
              "assets/preloaded.js",
              "assets/shared.js",
            ],
            external: [],
            passed: true,
          },
          {
            route: "/about",
            inlineBytes: brotliBytes(INLINE),
            scriptBytes: ABOUT_BYTES() - brotliBytes(INLINE),
            totalBytes: ABOUT_BYTES(),
            budgetBytes: 174_080,
            scripts: [
              "assets/about.js",
              "assets/main.js",
              "assets/preloaded.js",
              "assets/shared.js",
            ],
            external: [],
            passed: true,
          },
        ],
      });
    });

    it("fails the route a lazy chunk takes over budget as W-29, and passes the other", async () => {
      const budget = HOME_BYTES() - 1;
      const result = await run({ routes: ROUTES, budgets: { routeJsBytes: budget } });
      expect(result.verdict).toBe("fail");
      expect(
        result.findings.map((finding) => [finding.verdict, finding.law, finding.message]),
      ).toEqual([
        [
          "fail",
          "W-29",
          `route / JS is ${String(HOME_BYTES())} B brotli (exceeds budget ${String(budget)} B)`,
        ],
        [
          "pass",
          "W-29",
          `route /about JS is ${String(ABOUT_BYTES())} B brotli (<= ${String(budget)} B)`,
        ],
      ]);
    });

    it("lists a script from another origin without counting it", async () => {
      const other = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end("window.third = true;");
      });
      await new Promise<void>((listening) => {
        other.listen(0, "127.0.0.1", listening);
      });
      closers.push(
        () =>
          new Promise<void>((closed) => {
            other.close(() => {
              closed();
            });
            other.closeAllConnections();
          }),
      );
      const address = other.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const src = `http://127.0.0.1:${String(port)}/third.js`;
      const result = await run(
        { routes: ["/"] },
        { "dist/index.html": page(`<script src="${src}"></script>`) },
      );
      expect(reportOf(result)).toHaveProperty("routes.0.external", [src]);
      expect(reportOf(result)).toHaveProperty("routes.0.totalBytes", 0);
    });

    it.each([
      [
        "a chunk a page imports",
        {
          "dist/index.html": page(
            '<script type="module">import("/gone.js").catch(() => {});</script>',
          ),
        },
      ],
      ["a script tag", { "dist/index.html": page('<script src="/gone.js"></script>') }],
    ])("fails when %s is missing from dist", async (_name, files) => {
      const result = await run({ routes: ["/"] }, files);
      expect(result).toMatchObject({
        verdict: "fail",
        reason: "scripts did not load: /: /gone.js",
        findings: [{ rule: "route-script-failed" }],
      });
    });

    it("fails a declared route dist/ does not serve", async () => {
      const result = await run({ routes: ["/", "/missing"] });
      expect(result).toMatchObject({ verdict: "fail", findings: [{ rule: "route-not-served" }] });
    });

    it("fails with what Playwright says, when the browser is not installed", async () => {
      const dir = project(APP);
      const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(dir, "no-browsers") };
      const result = await routeBytesLayer().run(await built(dir, { routes: ["/"] }, { env }));
      expect(result).toMatchObject({ verdict: "fail", findings: [{ rule: "route-bytes-failed" }] });
      expect(result.reason).toMatch(/^route-bytes exited 1: [\s\S]*Executable doesn't exist/u);
    });
  },
);

interface Sent {
  readonly urls: readonly string[];
}

const isSent = (value: unknown): value is Sent =>
  typeof value === "object" && value !== null && "urls" in value;

/** The origin the layer asked for, read from its own request. */
function originOf(request: string): string {
  const sent: unknown = JSON.parse(readFileSync(request, "utf8"));
  return isSent(sent) ? new URL(String(sent.urls[0])).origin : "";
}

type Failure = "tool-timeout" | "tool-missing";

const answering =
  (code: number | null, stdout: string, stderr = "", failure?: Failure): Exec =>
  () =>
    Promise.resolve({ code, stdout, stderr, ...(failure === undefined ? {} : { failure }) });

/** A stand-in for the driver that answers with pages built on the served origin. */
const driving =
  (pages: (origin: string) => readonly object[]): Exec =>
  (command, args, options) =>
    answering(0, JSON.stringify(pages(originOf(String(args[1])))))(command, args, options);

const visit = (
  scripts: readonly string[],
  html = "<p></p>",
  failed: readonly string[] = [],
): object => ({
  status: 200,
  html,
  scripts: scripts.map((url) => ({ url, status: 200 })),
  failed,
});

const never: Exec = () => Promise.reject(new Error("nothing may be started"));

const SITE = {
  "dist/index.html": "<!DOCTYPE html><title>t</title>",
  "dist/a.js": filler("a", 9),
  "dist/b b.js": filler("b", 30),
};

const A = (): number => brotliBytes(SITE["dist/a.js"]);
const B = (): number => brotliBytes(SITE["dist/b b.js"]);

async function faked(setup: Setup, exec: Exec): Promise<LayerResult> {
  const context = await built(project(SITE), setup);
  return routeBytesLayer().run({ ...context, exec });
}

describe("route budgets", () => {
  it.each([
    ["no budgets", undefined, 174_080],
    ["no route key", { pageJsBytes: 5, pages: { "/x": 6 } }, 174_080],
    ["the budget for every route", { routeJsBytes: 100 }, 100],
    [
      "the route's own, over the one for every route",
      { routeJsBytes: 100, routes: { "/x": 7 } },
      7,
    ],
    ["another route's own, which does not apply", { routeJsBytes: 100, routes: { "/y": 7 } }, 100],
    ["a budget of zero", { routes: { "/x": 0 } }, 0],
  ])("take %s", (_name, budgets, expected) => {
    expect(routeBudget("/x", budgets)).toBe(expected);
  });

  it("is a gate 6 tier 1 layer of web-app, fed by the build layer", () => {
    expect(routeBytesLayer()).toMatchObject({
      id: "route-bytes",
      gate: 6,
      tier: 1,
      classes: ["web-app"],
      requires: ["build"],
      produces: ["route-bytes-json"],
      consumes: [{ artifact: "inventory", from: "build" }],
    });
    expect(PLAYWRIGHT()).toBe("@playwright/test");
  });
});

describe("route bytes from the driver's answer", () => {
  it("asks node for the driver, with a request under its own directory and a time limit", async () => {
    const dir = project(SITE);
    const outDir = join(dir, "not", "yet", "there");
    const context = { ...(await built(dir, { routes: ["/", "/x"] })), outDir };
    const calls: unknown[] = [];
    const result = await routeBytesLayer().run({
      ...context,
      exec: (command, args, options) => {
        calls.push({ command, args, options });
        return driving(() => [visit([]), visit([])])(command, args, options);
      },
    });
    const request = join(outDir, "route-bytes", "request.json");
    expect(calls).toEqual([
      {
        command: "node",
        args: [join(KIT, "src", "layers", "route-bytes", "drive.mjs"), request],
        options: { cwd: dir, env: context.env, timeoutMs: ROUTE_TIMEOUT_MS },
      },
    ]);
    expect(ROUTE_TIMEOUT_MS).toBe(300_000);
    expect(JSON.parse(readFileSync(request, "utf8"))).toEqual({
      cwd: dir,
      tool: "@playwright/test",
      viewport: { width: 1280, height: 720 },
      urls: [
        expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/u),
        expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/x$/u),
      ],
    });
    expect(result.artifacts).toEqual({
      "route-bytes-json": join(outDir, "route-bytes", "report.json"),
    });
    expect(closers).toHaveLength(1);
  });

  it("sums each served file once, decoded as the server reads it, with the inline scripts", async () => {
    const result = await faked(
      { routes: ["/"] },
      driving((origin) => [
        visit(
          [
            `${origin}/b%20b.js`,
            `${origin}/a.js`,
            `${origin}/a.js?v=2`,
            "https://cdn.example.com/z.js",
            "https://cdn.example.com/z.js",
            `${origin}9/near.js`,
          ],
          `<script>${INLINE}</script><script>${INLINE}</script><script type="importmap">{}</script>`,
        ),
      ]),
    );
    const inline = 2 * brotliBytes(INLINE);
    expect(reportOf(result)).toEqual({
      routes: [
        {
          route: "/",
          inlineBytes: inline,
          scriptBytes: A() + B(),
          totalBytes: inline + A() + B(),
          budgetBytes: 174_080,
          scripts: ["a.js", "b b.js"],
          external: [expect.stringMatching(/9\/near\.js$/u), "https://cdn.example.com/z.js"],
          passed: true,
        },
      ],
    });
  });

  it.each([
    ["at the budget", 0, "pass", "<="],
    ["one byte over", -1, "fail", "exceeds budget"],
  ])("judges a route %s", async (_name, delta, verdict, words) => {
    const budget = A() + delta;
    const result = await faked(
      { routes: ["/"], budgets: { routeJsBytes: budget } },
      driving((origin) => [visit([`${origin}/a.js`])]),
    );
    expect(result.verdict).toBe(verdict);
    expect(result.findings).toEqual([
      {
        tool: "webtops",
        rule: "W-29",
        law: "W-29",
        verdict,
        message: `route / JS is ${String(A())} B brotli (${words} ${String(budget)} B)`,
      },
    ]);
  });

  it("fails the layer when any one route is over", async () => {
    const result = await faked(
      { routes: ["/", "/x"], budgets: { routes: { "/x": 1 } } },
      driving((origin) => [visit([]), visit([`${origin}/a.js`])]),
    );
    expect(result.verdict).toBe("fail");
    expect(result.findings.map((finding) => finding.verdict)).toEqual(["pass", "fail"]);
  });

  it("fails on served scripts that are not files of dist/", async () => {
    const result = await faked(
      { routes: ["/"] },
      driving((origin) => [visit([`${origin}/virtual.js`, `${origin}/other.js`])]),
    );
    expect(result).toEqual({
      verdict: "fail",
      reason: "served scripts that are not files of dist/: other.js, virtual.js",
      findings: [expect.objectContaining({ rule: "route-script-unknown" })],
      artifacts: {},
    });
  });

  it("fails on scripts refused or never fetched, naming each route and path", async () => {
    const result = await faked(
      { routes: ["/", "/x"] },
      driving((origin) => [
        {
          ...visit([]),
          scripts: [
            { url: `${origin}/gone.js`, status: 404 },
            { url: `${origin}/a.js`, status: 399 },
          ],
        },
        visit([], "", [`${origin}/blocked.js`, `${origin}/blocked.js`]),
      ]),
    );
    expect(result).toMatchObject({
      verdict: "fail",
      reason: "scripts did not load: /: /gone.js, /x: /blocked.js",
      findings: [{ rule: "route-script-failed" }],
    });
  });

  it("measures a status below 400 and refuses 400 and over, naming each route", async () => {
    const setup = { routes: ["/", "/x"] };
    const fine = await faked(
      setup,
      driving(() => [{ ...visit([]), status: 399 }, visit([])]),
    );
    expect(fine.verdict).toBe("pass");
    const result = await faked(setup, answering(0, '[{"status":400},{"status":404}]'));
    expect(result).toMatchObject({
      verdict: "fail",
      reason: "dist/ serves no page for /, /x",
      findings: [{ rule: "route-not-served" }],
    });
  });

  const whole = '{"html":"","scripts":[],"failed":[]}';
  it.each([
    ["nothing", "", "0"],
    ["no result", "[]", "0"],
    ["no document", '[{"scripts":[],"failed":[]}]', "0"],
    ["no script list", '[{"html":"","failed":[]}]', "0"],
    ["no failure list", '[{"html":"","scripts":[]}]', "0"],
    ["more routes than asked", `[${whole},${whole}]`, "2"],
  ])("fails on %s", async (_name, stdout, count) => {
    expect(await faked({ routes: ["/"] }, answering(0, stdout))).toMatchObject({
      verdict: "fail",
      reason: `the browser answered ${count} of 1 routes`,
      findings: [{ rule: "route-bytes-unanswered" }],
    });
  });

  it("fails on a driver that exits non-zero, quoting the first lines it wrote", async () => {
    const result = await faked(
      { routes: ["/"] },
      answering(3, "", "\n\none\ntwo\nthree\nfour\nfive\n"),
    );
    expect(result).toMatchObject({
      verdict: "fail",
      reason: "route-bytes exited 3: one\ntwo\nthree\nfour",
      findings: [{ rule: "route-bytes-failed" }],
    });
  });

  it("fails a run that was killed for time", async () => {
    expect(await faked({ routes: ["/"] }, answering(null, "", "", "tool-timeout"))).toMatchObject({
      verdict: "fail",
      reason: "route-bytes did not finish in time and was killed",
      findings: [{ rule: "tool-timeout" }],
    });
  });
});

describe("route bytes fails closed", () => {
  it.each([
    ["no routes key", {}],
    ["an empty list", { routes: [] }],
  ])("is not-run with %s", async (_name, setup) => {
    const context = await built(project(SITE), setup);
    expect(await routeBytesLayer().run({ ...context, exec: never })).toEqual({
      verdict: "not-run",
      reason: "web-tops.yaml declares no routes for this web-app",
      findings: [],
      artifacts: {},
    });
  });

  it("is not-evaluated for a build with no page", async () => {
    const context = await built(project({ "dist/app.js": "export {};\n" }), { routes: ["/"] });
    expect(await routeBytesLayer().run({ ...context, exec: never })).toEqual({
      verdict: "not-evaluated",
      reason: "the build holds no HTML page",
      findings: [],
      artifacts: {},
    });
  });

  it("fails when there is no dist and nothing was handed over", async () => {
    const context = contextFor(project({}), { routes: ["/"] }, { exec: never });
    const result = await routeBytesLayer().run(context);
    expect(result).toMatchObject({ verdict: "fail", findings: [{ rule: "build-missing-dist" }] });
    expect(result.reason).toContain("dist");
  });

  it("fails when the handed-over dist is gone", async () => {
    const dir = project(SITE);
    const context = await built(dir, { routes: ["/"] });
    rmSync(join(dir, "dist"), { recursive: true });
    expect(await routeBytesLayer().run({ ...context, exec: never })).toEqual({
      verdict: "fail",
      reason: "the built directory is missing",
      findings: [expect.objectContaining({ rule: "build-missing-dist" })],
      artifacts: {},
    });
  });

  it("fails when Playwright is not installed", async () => {
    const dir = project(SITE, false);
    mkdirSync(join(dir, "node_modules", PLAYWRIGHT()), { recursive: true });
    expect(existsSync(join(dir, "node_modules", PLAYWRIGHT()))).toBe(true);
    const context = await built(dir, { routes: ["/"] });
    expect(await routeBytesLayer().run({ ...context, exec: never })).toMatchObject({
      verdict: "fail",
      reason: "@playwright/test is not installed in node_modules",
      findings: [{ rule: "tool-missing" }],
    });
  });

  it("never builds again what the build layer built", async () => {
    const dir = project(SITE);
    const setup = { routes: ["/"] };
    const build = { dir: "dist", command: "echo run >> builds.log" };
    const context = await built(dir, setup, { config: cfg({ class: "web-app", ...setup, build }) });
    const result = await routeBytesLayer().run({ ...context, exec: driving(() => [visit([])]) });
    expect(result.verdict).toBe("pass");
    expect(readFileSync(join(dir, "builds.log"), "utf8")).toBe("run\n");
  });
});
