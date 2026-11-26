import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import { REAL_TOOL_TIMEOUT } from "../../gate/test-support-timeouts.ts";
import { cfg, tempProject } from "../../gate/testkit.ts";
import type { Exec, LayerContext, LayerResult } from "../../gate/types.ts";
import { buildLayer } from "../build/index.ts";
import { htmlLayer } from "./index.ts";
import { passes } from "./passes.ts";
import { HTML_TIMEOUT_MS } from "./run.ts";

const KIT = resolve(import.meta.dirname, "../../..");
const made: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of made.splice(0)) cleanup();
});

function put(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

/** A project with `files` and, unless told otherwise, the kit's html-validate linked into its node_modules. */
function project(files: Readonly<Record<string, string>>, installed = true): string {
  const temp = tempProject();
  made.push(temp.cleanup);
  mkdirSync(join(temp.dir, "node_modules"));
  if (installed) {
    symlinkSync(
      join(KIT, "node_modules", "html-validate"),
      join(temp.dir, "node_modules", "html-validate"),
    );
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
  return htmlLayer().run(await built(project(files)));
}

const page = (body: string, head = ""): string =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Home</title>${head}</head>` +
  `<body><main><h1>Home</h1>${body}</main></body></html>`;

/**
 * What Astro 7.4 emits for a page with a scoped style, a framework island and a large stylesheet and script: no
 * quotes added, `data-astro-cid-*` attributes, an `astro-island` with escaped JSON, same-origin files without SRI.
 */
const ASTRO = page(
  '<p class="lead" data-astro-cid-lcdefpme>Read <a href="/about/" data-astro-cid-lcdefpme>about us</a>.</p>' +
    '<img src="/dot.svg" alt="A dot" width="8" height="8" data-astro-cid-lcdefpme>' +
    '<form action="/about/" method="get" data-astro-cid-lcdefpme><label for="q" data-astro-cid-lcdefpme>Search</label>' +
    '<input id="q" name="q" type="search" data-astro-cid-lcdefpme><button type="submit" data-astro-cid-lcdefpme>Go</button></form>' +
    "<style>astro-island,astro-slot,astro-static-slot{display:contents}</style>" +
    "<script>(function(){let e=async e=>{await(await e())()};(self.Astro||(self.Astro={})).load=e})();</script>" +
    '<astro-island uid="Z5mpNN" component-url="/_astro/Counter.DoQY__YA.js" component-export="default" ' +
    'renderer-url="/_astro/client.DB61OUeL.js" props="{&quot;start&quot;:[0,1]}" ssr client="load" ' +
    'opts="{&quot;name&quot;:&quot;Counter&quot;,&quot;value&quot;:true}" await-children>' +
    '<button type="button">Count 1</button><!--astro:end--></astro-island>' +
    '<script type="module" src="/_astro/index.astro_astro_type_script_index_0_lang.BD6cnQ-s.js"></script>',
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<link rel="stylesheet" href="/_astro/about.CMq4Dux3.css">' +
    "<style>.lead[data-astro-cid-lcdefpme]{color:#222}\n</style>",
);

const UNCLOSED = page("<div><p>text</p>");
const NO_ALT = page('<img src="/a.png">');

const rules = (result: LayerResult): (readonly [string | undefined, string])[] =>
  result.findings.map((finding) => [finding.law, finding.rule] as const);

const reportOf = (result: LayerResult): unknown =>
  JSON.parse(readFileSync(String(result.artifacts["html-report"]), "utf8"));

describe("the runs the gate pins", () => {
  it("runs standard and document for W-20 and a11y for W-22, and never recommended", () => {
    expect(passes()).toEqual([
      {
        law: "W-20",
        config: {
          root: true,
          extends: ["html-validate:standard", "html-validate:document"],
          rules: { "require-sri": ["error", { target: "crossorigin" }] },
        },
      },
      { law: "W-22", config: { root: true, extends: ["html-validate:a11y"] } },
    ]);
  });

  it("is a gate 6 tier 1 layer of the classes with pages, fed by the build layer", () => {
    expect(htmlLayer()).toMatchObject({
      id: "html",
      gate: 6,
      tier: 1,
      classes: ["ui-components", "astro-site", "web-app"],
      requires: ["build"],
      produces: ["html-report"],
      consumes: [{ artifact: "inventory", from: "build" }],
    });
  });
});

describe(
  "html layer over built pages, with the real html-validate",
  { timeout: REAL_TOOL_TIMEOUT },
  () => {
    it("passes compiled Astro output untouched, and writes an empty report", async () => {
      const result = await judged({ "dist/index.html": ASTRO });
      expect(result.findings).toEqual([]);
      expect(result.verdict).toBe("pass");
      expect(reportOf(result)).toEqual({ version: 1, pages: 1, findings: [] });
      expect(String(result.artifacts["html-report"])).toMatch(
        /\.web-tops\/out\/html\/report\.json$/u,
      );
    });

    it("fails an unclosed tag as W-20, with the file, line, column, rule and message", async () => {
      const result = await judged({ "dist/about/index.html": UNCLOSED, "dist/index.html": ASTRO });
      expect(result.verdict).toBe("fail");
      expect(rules(result)).toContainEqual(["W-20", "html-validate:close-order"]);
      const found = result.findings.find((finding) => finding.rule === "html-validate:close-order");
      expect(found).toMatchObject({ tool: "webtops", verdict: "fail", line: 1 });
      expect(found?.file).toBe("dist/about/index.html");
      expect(found?.message).toMatch(/Unclosed element '<div>' \(line 1, column \d+\)$/u);
      expect(reportOf(result)).toHaveProperty("pages", 2);
      expect(reportOf(result)).toHaveProperty("findings.0.law", "W-20");
      expect(reportOf(result)).toHaveProperty("findings.0.file", "about/index.html");
      expect(reportOf(result)).toHaveProperty("findings.0.line", 1);
      expect(reportOf(result)).toHaveProperty("findings.0.rule", "close-order");
    });

    it("fails an image without alt as W-22", async () => {
      const result = await judged({ "dist/index.html": NO_ALT });
      expect(result.verdict).toBe("fail");
      expect(rules(result)).toEqual([["W-22", "html-validate:wcag/h37"]]);
    });

    it("asks a cross-origin script for integrity", async () => {
      const result = await judged({
        "dist/index.html": page('<script src="https://cdn.example.com/x.js"></script>'),
      });
      expect(rules(result)).toEqual([["W-20", "html-validate:require-sri"]]);
    });

    it("reports a rule both runs hold once, under W-20", async () => {
      const result = await judged({ "dist/index.html": page('<p id="a">x</p><p id="a">y</p>') });
      expect(rules(result)).toEqual([["W-20", "html-validate:no-dup-id"]]);
    });

    it.each([
      ["element-permitted-content", page("<ul><div>x</div></ul>")],
      ["element-required-attributes", page('<img alt="a">')],
      ["heading-level", page("<h3>skipped</h3>")],
      ["no-missing-references", page('<label for="nope">n</label>')],
      ["missing-doctype", page("<p>x</p>").replace("<!DOCTYPE html>", "")],
    ])("holds the validity and whole-document rules: %s fails as W-20", async (rule, text) => {
      const result = await judged({ "dist/index.html": text });
      expect(rules(result)).toContainEqual(["W-20", `html-validate:${rule}`]);
    });

    it("reads no config and no ignore file of the project", async () => {
      const off = '{ "root": true, "rules": { "close-order": "off" } }\n';
      const result = await judged({
        ".htmlvalidate.json": off,
        "dist/.htmlvalidate.json": off,
        "html-validate.config.js": 'export default [{ rules: { "close-order": "off" } }];\n',
        ".htmlvalidateignore": "dist/\n",
        "dist/index.html": UNCLOSED,
      });
      expect(rules(result)).toContainEqual(["W-20", "html-validate:close-order"]);
    });

    it("never builds again what the build layer built", async () => {
      const dir = project({ "dist/index.html": ASTRO });
      const context = await built(dir, {
        config: cfg({
          class: "astro-site",
          build: { dir: "dist", command: "echo run >> builds.log" },
        }),
      });
      expect((await htmlLayer().run(context)).verdict).toBe("pass");
      expect(readFileSync(join(dir, "builds.log"), "utf8")).toBe("run\n");
    });
  },
);

describe("html layer fails closed", { timeout: REAL_TOOL_TIMEOUT }, () => {
  it("fails when there is no dist and nothing was handed over", async () => {
    const result = await htmlLayer().run(contextFor(project({})));
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]).toMatchObject({ rule: "build-missing-dist" });
  });

  it("fails when the handed-over dist is gone", async () => {
    const dir = project({ "dist/index.html": ASTRO });
    const context = await built(dir);
    rmSync(join(dir, "dist"), { recursive: true });
    const result = await htmlLayer().run(context);
    expect(result).toMatchObject({
      verdict: "fail",
      reason: 'the built directory "dist" is missing',
      findings: [{ tool: "webtops", rule: "build-missing-dist" }],
      artifacts: {},
    });
  });

  it("is not-evaluated, never a pass, for a build with no page", async () => {
    const result = await judged({ "dist/app.js": "export {};\n" });
    expect(result).toEqual({
      verdict: "not-evaluated",
      reason: 'no HTML page in "dist"',
      findings: [],
      artifacts: {},
    });
  });

  it("fails when html-validate is not installed, and starts nothing", async () => {
    const dir = project({ "dist/index.html": ASTRO }, false);
    const context = await built(dir);
    const result = await htmlLayer().run({
      ...context,
      exec: () => Promise.reject(new Error("nothing may be started")),
    });
    expect(result).toMatchObject({
      verdict: "fail",
      findings: [{ rule: "tool-missing" }],
      reason: "html-validate is not installed in node_modules",
    });
  });

  it("fails when a listed page cannot be read", async () => {
    const dir = project({ "dist/index.html": ASTRO, "dist/b.html": ASTRO });
    const context = await built(dir);
    rmSync(join(dir, "dist", "b.html"));
    const result = await htmlLayer().run(context);
    expect(result.verdict).toBe("fail");
    expect(result.findings[0]).toMatchObject({ rule: "html-validate-failed" });
    expect(result.reason).toMatch(/^html-validate exited 1: [\s\S]*ENOENT/u);
    expect(existsSync(join(dir, ".web-tops", "out", "html", "report.json"))).toBe(false);
  });
});

describe("html layer, a run that did not answer for every page", () => {
  const answering =
    (code: number | null, stdout: string, failure?: "tool-timeout"): Exec =>
    () =>
      Promise.resolve({
        code,
        stdout,
        stderr: "",
        ...(failure === undefined ? {} : { failure }),
      });

  it.each([
    ["nothing", "", "0 of 2"],
    ["no result", "[]", "0 of 2"],
    ["half the results", "[{}]", "1 of 2"],
    ["more than asked", "[{},{},{}]", "3 of 2"],
  ])("fails on %s", async (_name, stdout, counted) => {
    const context = await built(project({ "dist/index.html": ASTRO }));
    const result = await htmlLayer().run({ ...context, exec: answering(0, stdout) });
    expect(result).toMatchObject({
      verdict: "fail",
      reason: `html-validate answered ${counted} page results`,
      findings: [{ rule: "html-validate-incomplete" }],
    });
  });

  it("counts only errors, not warnings", async () => {
    const context = await built(project({ "dist/index.html": ASTRO }));
    const warning = { severity: 1, ruleId: "x", line: 1, column: 1, message: "m" };
    const answer = JSON.stringify([{ law: "W-20", file: "index.html", messages: [warning] }, {}]);
    const result = await htmlLayer().run({ ...context, exec: answering(0, answer) });
    expect(result).toMatchObject({ verdict: "pass", findings: [] });
  });

  it("fails a run that was killed for time, which it asks for", async () => {
    const context = await built(project({ "dist/index.html": ASTRO }));
    const asked: (number | undefined)[] = [];
    const result = await htmlLayer().run({
      ...context,
      exec: (command, args, options) => {
        asked.push(options?.timeoutMs);
        appendFileSync(join(context.cwd, "asked"), `${command} ${String(args.length)}\n`);
        return answering(null, "", "tool-timeout")(command, args, options);
      },
    });
    expect(asked).toEqual([HTML_TIMEOUT_MS]);
    expect(HTML_TIMEOUT_MS).toBe(120_000);
    expect(readFileSync(join(context.cwd, "asked"), "utf8")).toBe("node 2\n");
    expect(result).toMatchObject({ verdict: "fail", findings: [{ rule: "tool-timeout" }] });
  });
});
