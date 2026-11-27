import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

const YAML = (routes: string): string =>
  `protocol: "0.3.0"\nversion: "1"\npackage: app\nclass: web-app\nenforce: hard\n${routes}report: { path: .web-tops/report.json }\n`;

const app = async (files: Readonly<Record<string, string>>): Promise<LayerContext> =>
  built(project(files), { config: cfg({ class: "web-app" }) });

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

describe.skipIf(insideStryker)(
  "axe layer in headless Chromium",
  { timeout: REAL_TOOL_TIMEOUT },
  () => {
    it("passes a clean page and writes its report", async () => {
      const result = await judged({ "dist/index.html": CLEAN });
      expect(result).toMatchObject({ verdict: "pass", findings: [] });
      expect(reportOf(result)).toEqual({
        version: 1,
        routes: ["/"],
        violations: [],
        incomplete: [],
      });
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
    });

    it("is not-evaluated, never a pass, when axe cannot decide", async () => {
      const result = await judged({ "dist/index.html": GRADIENT });
      expect(result.verdict).toBe("not-evaluated");
      expect(shown(result)).toEqual([
        ["not-evaluated", "W-21", "axe:color-contrast", "axe color-contrast at p"],
      ]);
    });

    it("lists a moderate violation without failing", async () => {
      const result = await judged({ "dist/index.html": NO_ZOOM });
      expect(result.verdict).toBe("pass");
      expect(shown(result)).toEqual([
        ["pass", "W-21", "axe:meta-viewport", 'axe meta-viewport at meta[name="viewport"]'],
      ]);
    });

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

    it("fails a declared route dist/ does not serve", async () => {
      const context = await app({ "dist/index.html": CLEAN });
      const result = await axeLayer(() => ["/", "/missing"]).run(context);
      expect(result).toMatchObject({
        verdict: "fail",
        reason: "dist/ serves no page for /missing",
        findings: [{ rule: "axe-route-not-served" }],
      });
    });

    it("fails, and still exits, when a page cannot be loaded", async () => {
      const context = await app({ "dist/index.html": CLEAN, "dist/data.bin": "x" });
      const result = await axeLayer(() => ["/data.bin"]).run(context);
      expect(result.findings[0]).toMatchObject({ rule: "axe-failed" });
      expect(result.reason).toMatch(/^axe exited 1: [\s\S]*Download is starting/u);
    });

    it("fails with what Playwright says, when the browser is not installed", async () => {
      const dir = project({ "dist/index.html": CLEAN });
      const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(dir, "no-browsers") };
      const result = await axeLayer().run(await built(dir, { env }));
      expect(result).toMatchObject({ verdict: "fail", findings: [{ rule: "axe-failed" }] });
      expect(result.reason).toMatch(/^axe exited 1: [\s\S]*Executable doesn't exist/u);
    });
  },
);

const answering =
  (
    code: number | null,
    stdout: string,
    stderr = "",
    failure?: "tool-timeout" | "tool-missing",
  ): Exec =>
  () =>
    Promise.resolve({ code, stdout, stderr, ...(failure === undefined ? {} : { failure }) });

/** What the driver prints for one page. */
const answer = (
  violations: readonly object[] = [],
  incomplete: readonly object[] = [],
  status = 200,
): object => ({ status, violations, incomplete });

const printing = (...pages: readonly object[]): Exec => answering(0, JSON.stringify(pages));

const rule = (id: string, impact: string | null, ...targets: readonly unknown[]): object => ({
  id,
  impact,
  help: `${id} help`,
  nodes: targets.map((target) => ({ target })),
});

const never: Exec = () => Promise.reject(new Error("nothing may be started"));

/** An astro-site with one clean page, judged by a stand-in for the driver. */
async function faked(
  exec: Exec,
  files: Readonly<Record<string, string>> = {},
): Promise<LayerResult> {
  const context = await built(project({ "dist/index.html": CLEAN, ...files }));
  return axeLayer().run({ ...context, exec });
}

describe("axe layer reading the driver's answer", () => {
  it("asks node for the driver, with a request under its own directory and a time limit", async () => {
    const dir = project({ "dist/index.html": CLEAN, "dist/about/index.html": CLEAN });
    const outDir = join(dir, "not", "yet", "there");
    const context = { ...(await built(dir)), outDir };
    const calls: unknown[] = [];
    const result = await axeLayer().run({
      ...context,
      exec: (command, args, options) => {
        calls.push({ command, args, options });
        return printing(answer(), answer())(command, args, options);
      },
    });
    const request = join(outDir, "axe", "request.json");
    expect(calls).toEqual([
      {
        command: "node",
        args: [join(KIT, "src", "layers", "axe", "drive.mjs"), request],
        options: { cwd: dir, env: context.env, timeoutMs: AXE_TIMEOUT_MS },
      },
    ]);
    expect(AXE_TIMEOUT_MS).toBe(300_000);
    const sent: unknown = JSON.parse(readFileSync(request, "utf8"));
    expect(sent).toEqual({
      cwd: dir,
      tools: toolPackages(),
      options: axeOptions(),
      viewport: viewport(),
      urls: [
        expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/about\/$/u),
        expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/u),
      ],
    });
    expect(result.artifacts).toEqual({ "axe-report": join(outDir, "axe", "report.json") });
    expect(closers).toHaveLength(1);
  });

  it("passes pages with nothing to report, and writes an empty report", async () => {
    const result = await faked(printing(answer()));
    expect(result).toEqual({
      verdict: "pass",
      findings: [],
      artifacts: result.artifacts,
    });
    expect(reportOf(result)).toEqual({ version: 1, routes: ["/"], violations: [], incomplete: [] });
  });

  it("fails serious and critical violations, target-size as W-44 and any other rule as W-21", async () => {
    const result = await faked(
      printing(
        answer([
          rule("target-size", "serious", ["#a"], ["#b"]),
          rule("image-alt", "critical", ["img"]),
        ]),
      ),
    );
    expect(result.verdict).toBe("fail");
    expect(result).not.toHaveProperty("reason");
    expect(result.findings).toEqual(
      [
        ["W-44", "target-size", "#a"],
        ["W-44", "target-size", "#b"],
        ["W-21", "image-alt", "img"],
      ].map(([law, id, selector]) => ({
        tool: "webtops",
        rule: `axe:${String(id)}`,
        law,
        verdict: "fail",
        message: `axe ${String(id)} at ${String(selector)}`,
        file: "dist/index.html",
      })),
    );
    expect(new Set(fingerprints(result)).size).toBe(3);
    expect(reportOf(result)).toHaveProperty("violations.2", {
      route: "/",
      file: "index.html",
      law: "W-21",
      rule: "image-alt",
      impact: "critical",
      help: "image-alt help",
      selector: "img",
    });
  });

  it.each([
    ["moderate", "pass"],
    ["minor", "pass"],
    ["serious", "fail"],
    ["critical", "fail"],
  ])("judges a %s violation as %s", async (impact, verdict) => {
    const result = await faked(printing(answer([rule("r", impact, ["p"])])));
    expect(result.verdict).toBe(verdict);
    expect(result.findings.map((finding) => finding.verdict)).toEqual([verdict]);
  });

  it("fails a violation whose impact axe did not give, and records it as unknown", async () => {
    const result = await faked(printing(answer([rule("r", null, ["p"])])));
    expect(result.verdict).toBe("fail");
    expect(reportOf(result)).toHaveProperty("violations.0.impact", "unknown");
  });

  it("counts a rule that names no element once, never as nothing", async () => {
    const result = await faked(printing(answer([{ id: "r", impact: "serious" }])));
    expect(result.findings.map((finding) => finding.message)).toEqual(["axe r at "]);
    expect(result.verdict).toBe("fail");
  });

  it("writes frames and shadow roots into the selector", async () => {
    const result = await faked(
      printing(answer([rule("r", "serious", ["iframe", ["#host", "img"]])])),
    );
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "axe r at iframe >>> #host >> img",
    ]);
  });

  it("is not-evaluated for what axe left incomplete, whatever its impact", async () => {
    const result = await faked(
      printing(answer([rule("m", "moderate", ["a"])], [rule("c", "minor", ["p"], ["q"])])),
    );
    expect(result.verdict).toBe("not-evaluated");
    expect(result.reason).toBe("axe could not decide 2 result(s)");
    expect(result.findings.map((finding) => [finding.rule, finding.verdict])).toEqual([
      ["axe:m", "pass"],
      ["axe:c", "not-evaluated"],
      ["axe:c", "not-evaluated"],
    ]);
    expect(reportOf(result)).toHaveProperty("incomplete.1.selector", "q");
  });

  it("fails a violation even beside an undecided result", async () => {
    const result = await faked(
      printing(answer([rule("v", "serious", ["a"])], [rule("c", "serious", ["p"])])),
    );
    expect(result.verdict).toBe("fail");
    expect(result.findings.map((finding) => finding.verdict)).toEqual(["fail", "not-evaluated"]);
  });

  it("puts each page's results on that page", async () => {
    const result = await faked(printing(answer([rule("a", "serious", ["x"])]), answer()), {
      "dist/about/index.html": CLEAN,
    });
    expect(result.findings.map((finding) => finding.file)).toEqual(["dist/about/index.html"]);
  });

  it.each([
    ["nothing", "", "0 of 1"],
    ["no result", "[]", "0 of 1"],
    ["a result with no lists", '[{"status":200}]', "0 of 1"],
    ["no incomplete list", '[{"status":200,"violations":[]}]', "0 of 1"],
    ["no violations list", '[{"status":200,"incomplete":[]}]', "0 of 1"],
    [
      "more pages than asked",
      '[{"violations":[],"incomplete":[]},{"violations":[],"incomplete":[]}]',
      "2 of 1",
    ],
  ])("fails on %s", async (_name, stdout, counted) => {
    expect(await faked(answering(0, stdout))).toEqual({
      verdict: "fail",
      reason: `axe answered ${counted} pages`,
      findings: [
        {
          tool: "webtops",
          rule: "axe-unanswered",
          verdict: "fail",
          message: `axe answered ${counted} pages`,
        },
      ],
      artifacts: {},
    });
  });

  it("judges a status below 400 and refuses 400 and over, naming each route", async () => {
    const files = { "dist/about/index.html": CLEAN };
    expect((await faked(printing(answer([], [], 399), answer()), files)).verdict).toBe("pass");
    const result = await faked(printing({ status: 400 }, { status: 404 }), files);
    expect(result).toMatchObject({
      verdict: "fail",
      reason: "dist/ serves no page for /about/, /",
      findings: [{ rule: "axe-route-not-served" }],
    });
  });

  it("fails on a driver that exits non-zero, quoting the first lines it wrote", async () => {
    const result = await faked(answering(3, "", "\n\none\ntwo\nthree\nfour\nfive\n"));
    expect(result).toMatchObject({
      verdict: "fail",
      reason: "axe exited 3: one\ntwo\nthree\nfour",
      findings: [{ rule: "axe-failed" }],
    });
  });

  it("fails a run that was killed for time", async () => {
    expect(await faked(answering(null, "", "", "tool-timeout"))).toMatchObject({
      verdict: "fail",
      reason: "axe did not finish in time and was killed",
      findings: [{ rule: "tool-timeout" }],
    });
  });
});

describe("axe layer on a web-app's declared routes", () => {
  it("takes them from web-tops.yaml", async () => {
    const context = await app({
      "web-tops.yaml": YAML('routes: ["/", "/about"]\n'),
      "dist/index.html": CLEAN,
    });
    expect(configuredRoutes(context)).toEqual(["/", "/about"]);
    const result = await axeLayer().run({ ...context, exec: printing(answer(), answer()) });
    expect(reportOf(result)).toMatchObject({ routes: ["/", "/about"] });
  });

  it.each([
    ["/", "index.html"],
    ["/about", "about.html"],
    ["/docs?tab=12", "docs/index.html"],
    ["/docs/#part", "docs/index.html"],
    ["/a/b/", "a/b.html"],
    ["/data.json", "data.json"],
    ["/my%20page", undefined],
  ])("names the built file that answers %s", async (route, file) => {
    const context = await app({ "dist/index.html": CLEAN });
    const files = ["index.html", "about.html", "docs/index.html", "a/b.html", "data.json"];
    const inventory = { distDir: "", pages: [], files: [...files, "my page.html"] };
    expect(targetsOf(context, inventory, () => [route])).toEqual([
      file === undefined ? { route } : { route, file },
    ]);
  });

  it("judges a route whose built file it cannot name, and names no file", async () => {
    const context = await app({ "dist/index.html": CLEAN });
    const result = await axeLayer(() => ["/elsewhere"]).run({
      ...context,
      exec: printing(answer([rule("r", "serious", ["p"])])),
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).not.toHaveProperty("file");
  });

  it("takes every built page for a class other than web-app, whatever routes say", async () => {
    const context = await built(project({ "dist/index.html": CLEAN }));
    const inventory = {
      distDir: "",
      files: [],
      pages: [{ route: "/b", file: "b.html", bytes: 1 }],
    };
    expect(targetsOf(context, inventory, () => ["/x"])).toEqual([{ route: "/b", file: "b.html" }]);
  });
});

describe("axe layer fails closed", () => {
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
    expect(result.reason).toContain("dist");
  });

  it("fails when the handed-over dist is gone", async () => {
    const dir = project({ "dist/index.html": CLEAN });
    const context = await built(dir);
    rmSync(join(dir, "dist"), { recursive: true });
    expect(await axeLayer().run({ ...context, exec: never })).toEqual({
      verdict: "fail",
      reason: "the built directory is missing",
      findings: [
        {
          tool: "webtops",
          rule: "build-missing-dist",
          verdict: "fail",
          message: "the built directory is missing",
        },
      ],
      artifacts: {},
    });
  });

  it.each([
    ["neither", [], "@playwright/test"],
    ["only Playwright", ["@playwright/test"], "@axe-core/playwright"],
  ])("fails when %s is installed, naming what is missing", async (_name, installed, named) => {
    const dir = project({ "dist/index.html": CLEAN }, false);
    for (const name of installed) {
      put(dir, { [`node_modules/${name}/package.json`]: "{}\n" });
    }
    // An empty package directory is not an installed package.
    mkdirSync(join(dir, "node_modules", named), { recursive: true });
    expect(existsSync(join(dir, "node_modules", named))).toBe(true);
    const context = await built(dir);
    expect(await axeLayer().run({ ...context, exec: never })).toMatchObject({
      verdict: "fail",
      reason: `${named} is not installed in node_modules`,
      findings: [{ rule: "tool-missing" }],
    });
  });

  it("never builds again what the build layer built", async () => {
    const dir = project({ "dist/index.html": CLEAN });
    const context = await built(dir, {
      config: cfg({
        class: "astro-site",
        build: { dir: "dist", command: "echo run >> builds.log" },
      }),
    });
    expect((await axeLayer().run({ ...context, exec: printing(answer()) })).verdict).toBe("pass");
    expect(readFileSync(join(dir, "builds.log"), "utf8")).toBe("run\n");
  });
});
