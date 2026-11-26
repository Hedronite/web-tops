import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import { cfg, tempProject } from "../../gate/testkit.ts";
import type { Exec, LayerContext, LayerResult } from "../../gate/types.ts";
import { completeFindings } from "../../report/findings.ts";
import { buildLayer } from "../build/index.ts";
import { axeLayer } from "./index.ts";
import { axeOptions, toolPackages, viewport } from "./options.ts";
import { AXE_TIMEOUT_MS } from "./run.ts";
import { configuredRoutes, targetsOf } from "./targets.ts";

const KIT = resolve(import.meta.dirname, "../../..");
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

/** A project with `files` and, unless told otherwise, the kit's Playwright and axe linked into its node_modules. */
function project(files: Readonly<Record<string, string>>, installed = true): string {
  const temp = tempProject();
  made.push(temp.cleanup);
  mkdirSync(join(temp.dir, "node_modules"));
  for (const name of installed ? Object.values(toolPackages()) : []) {
    mkdirSync(dirname(join(temp.dir, "node_modules", name)), { recursive: true });
    symlinkSync(join(KIT, "node_modules", name), join(temp.dir, "node_modules", name));
  }
  put(temp.dir, { "package.json": '{ "name": "site", "type": "module" }\n', ...files });
  return temp.dir;
}

function contextFor(dir: string, over: Partial<LayerContext> = {}): LayerContext {
  return {
    cwd: dir,
    config: cfg({ class: "astro-site" }),
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
async function built(dir: string, over: Partial<LayerContext> = {}): Promise<LayerContext> {
  const context = contextFor(dir, over);
  const result = await buildLayer.run(context);
  return { ...context, artifacts: new Map(Object.entries(result.artifacts)) };
}

async function judged(files: Readonly<Record<string, string>>): Promise<LayerResult> {
  return axeLayer().run(await built(project(files)));
}

const page = (body: string, head = ""): string =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Home</title>${head}</head>` +
  `<body><main><h1>Home</h1>${body}</main></body></html>`;

const SMALL = "width:13px;height:13px;padding:0;margin:0;border:0";
const small = (label: string): string =>
  `<button type="button" aria-label="${label}" style="${SMALL}"></button>`;

const CLEAN = page('<p>Read <a href="/about/">about us</a>.</p><button type="button">Go</button>');
const CROWDED = page(`<div style="display:flex">${small("a")}${small("b")}</div>`);
const NO_ALT = page('<img src="/a.png" width="30" height="30">');
const GRADIENT = page(
  '<p style="background-image:linear-gradient(#000,#fff);color:#777">text on a gradient</p>',
);
const NO_ZOOM = page(
  "<p>x</p>",
  '<meta name="viewport" content="width=device-width, user-scalable=no">',
);

const shown = (result: LayerResult): (readonly [string, string | undefined, string, string])[] =>
  result.findings.map(
    (finding) => [finding.verdict, finding.law, finding.rule, finding.message] as const,
  );

const reportOf = (result: LayerResult): unknown =>
  JSON.parse(readFileSync(String(result.artifacts["axe-report"]), "utf8"));

const fingerprints = (result: LayerResult): string[] =>
  completeFindings(result.findings, () => undefined).map((finding) => finding.fingerprint);

describe("the run the gate pins", () => {
  it("runs the four WCAG A and AA tags and switches target-size on by id", () => {
    expect(axeOptions()).toEqual({
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      rules: { "target-size": { enabled: true } },
    });
    expect(viewport()).toEqual({ width: 1280, height: 720 });
    expect(toolPackages()).toEqual({ playwright: "@playwright/test", axe: "@axe-core/playwright" });
  });

  it("is a gate 6 tier 1 layer of the classes with pages, fed by the build layer", () => {
    expect(axeLayer()).toMatchObject({
      id: "axe",
      gate: 6,
      tier: 1,
      classes: ["ui-components", "astro-site", "web-app"],
      requires: ["build"],
      produces: ["axe-report"],
      consumes: [{ artifact: "inventory", from: "build" }],
    });
  });
});

describe("axe layer in headless Chromium", { timeout: REAL_TOOL_TIMEOUT }, () => {
  it("passes a clean page, writes its report and registers the server to be closed", async () => {
    const context = await built(project({ "dist/index.html": CLEAN }));
    const result = await axeLayer().run(context);
    expect(result).toMatchObject({ verdict: "pass", findings: [] });
    expect(reportOf(result)).toEqual({ version: 1, routes: ["/"], violations: [], incomplete: [] });
    expect(String(result.artifacts["axe-report"])).toMatch(/\.web-tops\/out\/axe\/report\.json$/u);
    expect(closers).toHaveLength(1);
  });

  it("fails crowded 13px targets as W-44, each fingerprinted by rule and selector", async () => {
    const first = await judged({ "dist/index.html": CROWDED });
    expect(first.verdict).toBe("fail");
    expect(shown(first)).toEqual([
      ["fail", "W-44", "axe:target-size", 'axe target-size at button[aria-label="a"]'],
      ["fail", "W-44", "axe:target-size", 'axe target-size at button[aria-label="b"]'],
    ]);
    expect(first.findings[0]).toMatchObject({ tool: "webtops", file: "dist/index.html" });
    const again = await judged({ "dist/index.html": CROWDED });
    expect(fingerprints(again)).toEqual(fingerprints(first));
    expect(new Set(fingerprints(first)).size).toBe(2);
    expect(reportOf(first)).toHaveProperty("violations.0.impact", "serious");
  });

  it("passes a lone small target with room around it, as WCAG 2.5.8 does", async () => {
    const result = await judged({ "dist/index.html": page(small("a")) });
    expect(result).toMatchObject({ verdict: "pass", findings: [] });
  });

  it("judges every built page, and fails a WCAG defect as W-21 on the page that holds it", async () => {
    const result = await judged({ "dist/index.html": CLEAN, "dist/about/index.html": NO_ALT });
    expect(result.verdict).toBe("fail");
    expect(shown(result)).toEqual([["fail", "W-21", "axe:image-alt", "axe image-alt at img"]]);
    expect(result.findings[0]?.file).toBe("dist/about/index.html");
    expect(reportOf(result)).toMatchObject({ routes: ["/about/", "/"] });
    expect(reportOf(result)).toHaveProperty("violations.0.route", "/about/");
    expect(reportOf(result)).toHaveProperty("violations.0.selector", "img");
  });

  it("is not-evaluated, never a pass, when axe cannot decide", async () => {
    const result = await judged({ "dist/index.html": GRADIENT });
    expect(result.verdict).toBe("not-evaluated");
    expect(result.reason).toBe("axe could not decide 1 result(s)");
    expect(shown(result)).toEqual([
      ["not-evaluated", "W-21", "axe:color-contrast", "axe color-contrast at p"],
    ]);
    expect(reportOf(result)).toHaveProperty("incomplete.0.rule", "color-contrast");
  });

  it("fails a violation even beside an undecided result", async () => {
    const result = await judged({ "dist/a.html": GRADIENT, "dist/b.html": NO_ALT });
    expect(result.verdict).toBe("fail");
    expect(result.findings.map((finding) => finding.verdict)).toEqual(["fail", "not-evaluated"]);
  });

  it("lists a moderate violation without failing", async () => {
    const result = await judged({ "dist/index.html": NO_ZOOM });
    expect(result.verdict).toBe("pass");
    expect(shown(result)).toEqual([
      ["pass", "W-21", "axe:meta-viewport", 'axe meta-viewport at meta[name="viewport"]'],
    ]);
  });

  it("never builds again what the build layer built", async () => {
    const dir = project({ "dist/index.html": CLEAN });
    const context = await built(dir, {
      config: cfg({
        class: "astro-site",
        build: { dir: "dist", command: "echo run >> builds.log" },
      }),
    });
    expect((await axeLayer().run(context)).verdict).toBe("pass");
    expect(readFileSync(join(dir, "builds.log"), "utf8")).toBe("run\n");
  });
});

describe("axe layer without its browser", { timeout: REAL_TOOL_TIMEOUT }, () => {
  it("fails with what Playwright says, when the browser is not installed", async () => {
    const dir = project({ "dist/index.html": CLEAN });
    const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(dir, "no-browsers") };
    const result = await axeLayer().run(await built(dir, { env }));
    expect(result).toMatchObject({ verdict: "fail", findings: [{ rule: "axe-failed" }] });
    expect(result.reason).toMatch(/^axe exited 1: [\s\S]*Executable doesn't exist/u);
  });
});

const YAML = (routes: string): string =>
  `protocol: "0.3.0"\nversion: "1"\npackage: app\nclass: web-app\nenforce: hard\n${routes}report: { path: .web-tops/report.json }\n`;

const app = async (files: Readonly<Record<string, string>>): Promise<LayerContext> =>
  built(project(files), { config: cfg({ class: "web-app" }) });

describe("axe layer on a web-app's declared routes", { timeout: REAL_TOOL_TIMEOUT }, () => {
  it("judges the routes web-tops.yaml declares, and no other page", async () => {
    const context = await app({
      "web-tops.yaml": YAML('routes: ["/", "/about"]\n'),
      "dist/index.html": CLEAN,
      "dist/about.html": CLEAN,
      "dist/hidden.html": NO_ALT,
    });
    const result = await axeLayer().run(context);
    expect(result).toMatchObject({ verdict: "pass", findings: [] });
    expect(reportOf(result)).toMatchObject({ routes: ["/", "/about"] });
  });

  it("names the built file that answers a declared route", async () => {
    const context = await app({ "dist/index.html": CLEAN, "dist/docs/index.html": NO_ALT });
    const result = await axeLayer(() => ["/docs?tab=1"]).run(context);
    expect(result.findings[0]?.file).toBe("dist/docs/index.html");
  });

  it("still judges a route whose built file it cannot name, and names no file", async () => {
    const context = await app({ "dist/index.html": CLEAN, "dist/my page.html": NO_ALT });
    const result = await axeLayer(() => ["/my%20page"]).run(context);
    expect(result.findings.map((finding) => finding.rule)).toEqual(["axe:image-alt"]);
    expect(result.findings[0]).not.toHaveProperty("file");
  });

  it("fails a declared route dist/ does not serve", async () => {
    const context = await app({ "dist/index.html": CLEAN });
    const result = await axeLayer(() => ["/", "/missing"]).run(context);
    expect(result).toMatchObject({
      verdict: "fail",
      reason: "dist/ serves no page for /missing",
      findings: [{ rule: "axe-route-not-served" }],
      artifacts: {},
    });
  });

  it("fails, and still exits, when a page cannot be loaded", async () => {
    const context = await app({ "dist/index.html": CLEAN, "dist/data.bin": "x" });
    const result = await axeLayer(() => ["/data.bin"]).run(context);
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]).toMatchObject({ rule: "axe-failed" });
    expect(result.reason).toMatch(/^axe exited 1: [\s\S]*Download is starting/u);
  });
});

describe("axe layer fails closed", () => {
  const never: Exec = () => Promise.reject(new Error("nothing may be started"));

  it.each([
    ["no routes key", YAML("")],
    ["an unreadable config", "routes: ["],
  ])("is not-run for a web-app with %s", async (_name, yaml) => {
    const context = await app({ "web-tops.yaml": yaml, "dist/index.html": CLEAN });
    expect(configuredRoutes(context)).toEqual([]);
    expect(await axeLayer().run({ ...context, exec: never })).toEqual({
      verdict: "not-run",
      reason: "web-tops.yaml declares no routes for this web-app",
      findings: [],
      artifacts: {},
    });
  });

  it("is not-evaluated for a build with no page", async () => {
    const context = await built(project({ "dist/app.js": "export {};\n" }));
    expect(await axeLayer().run({ ...context, exec: never })).toEqual({
      verdict: "not-evaluated",
      reason: "the build holds no HTML page",
      findings: [],
      artifacts: {},
    });
  });

  it("fails when there is no dist and nothing was handed over", async () => {
    const result = await axeLayer().run(contextFor(project({}), { exec: never }));
    expect(result).toMatchObject({ verdict: "fail", findings: [{ rule: "build-missing-dist" }] });
  });

  it("fails when the handed-over dist is gone", async () => {
    const dir = project({ "dist/index.html": CLEAN });
    const context = await built(dir);
    rmSync(join(dir, "dist"), { recursive: true });
    expect(await axeLayer().run({ ...context, exec: never })).toMatchObject({
      verdict: "fail",
      reason: "the built directory is missing",
      findings: [{ rule: "build-missing-dist" }],
    });
  });

  it("fails when a tool is not installed, naming it", async () => {
    const context = await built(project({ "dist/index.html": CLEAN }, false));
    expect(await axeLayer().run({ ...context, exec: never })).toMatchObject({
      verdict: "fail",
      reason: "@playwright/test is not installed in node_modules",
      findings: [{ rule: "tool-missing" }],
    });
  });

  it("takes every built page for a class other than web-app, whatever routes say", async () => {
    const context = await built(project({ "dist/index.html": CLEAN, "dist/b.html": CLEAN }));
    const inventory = {
      distDir: "",
      files: [],
      pages: [{ route: "/b", file: "b.html", bytes: 1 }],
    };
    expect(targetsOf(context, inventory, () => ["/x"])).toEqual([{ route: "/b", file: "b.html" }]);
  });
});

describe("axe layer reading the driver's answer", () => {
  const answering =
    (code: number | null, stdout: string, failure?: "tool-timeout"): Exec =>
    () =>
      Promise.resolve({
        code,
        stdout,
        stderr: "",
        ...(failure === undefined ? {} : { failure }),
      });

  async function answered(exec: Exec): Promise<LayerResult> {
    const context = await built(project({ "dist/index.html": CLEAN }));
    return axeLayer().run({ ...context, exec });
  }

  const one = (violations: readonly object[]): string =>
    JSON.stringify([{ status: 200, violations, incomplete: [] }]);

  it.each([
    ["nothing", ""],
    ["no result", "[]"],
    ["a result with no lists", '[{"status":200}]'],
    ["a result with one list", '[{"status":200,"violations":[]}]'],
  ])("fails on %s", async (_name, stdout) => {
    expect(await answered(answering(0, stdout))).toMatchObject({
      verdict: "fail",
      reason: "axe answered 0 of 1 pages",
      findings: [{ rule: "axe-unanswered" }],
    });
  });

  it("writes frames and shadow roots into the selector", async () => {
    const nodes = [{ target: ["iframe", ["#host", "img"]] }];
    const result = await answered(
      answering(0, one([{ id: "image-alt", impact: "critical", nodes }])),
    );
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "axe image-alt at iframe >>> #host >> img",
    ]);
  });

  it.each([
    ["an impact axe did not give", { id: "r" }, "fail"],
    ["a critical impact", { id: "r", impact: "critical", nodes: [] }, "fail"],
    ["a minor impact", { id: "r", impact: "minor", nodes: [] }, "pass"],
  ])("counts a violation with %s once even with no element: %s", async (_name, found, verdict) => {
    const result = await answered(answering(0, one([found])));
    expect(result.verdict).toBe(verdict);
    expect(result.findings).toHaveLength(1);
  });

  it("fails a run that was killed for time, which it asks for", async () => {
    const asked: (number | undefined)[] = [];
    const result = await answered((command, args, options) => {
      asked.push(options?.timeoutMs);
      return answering(null, "", "tool-timeout")(command, args, options);
    });
    expect(asked).toEqual([AXE_TIMEOUT_MS]);
    expect(AXE_TIMEOUT_MS).toBe(300_000);
    expect(result).toMatchObject({ verdict: "fail", findings: [{ rule: "tool-timeout" }] });
  });
});
