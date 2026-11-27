import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGate, sourceReader } from "../../gate/runner.ts";
import { cfg, opts, tempProject, tickingClock } from "../../gate/testkit.ts";
import type { LayerContext } from "../../gate/types.ts";
import { buildLayer } from "../build/index.ts";
import { linksLayer } from "./index.ts";
import { parseHtmlPage } from "./parse.ts";

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

function runLinksGate(cwd: string, onExec: () => void = () => undefined) {
  return runGate({
    layers: [buildLayer, linksLayer],
    config: cfg({ class: "astro-site" }),
    options: opts(),
    cwd,
    env: process.env,
    exec: () => {
      onExec();
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    },
    outDir: join(cwd, ".web-tops", "out"),
    now: tickingClock(),
  });
}

function assertFailedLink(
  report: Awaited<ReturnType<typeof runLinksGate>>,
  expectedFile: string,
  expectedTarget: string,
): void {
  expect(report.passed).toBe(false);
  expect(report.exit_code).toBe(1);
  const layer = report.layers.find((entry) => entry.id === "links");
  if (layer === undefined) throw new Error("missing links layer");
  expect(layer.verdict).toBe("fail");
  expect(layer.findings[0]).toMatchObject({ rule: "links", file: expectedFile, line: 3 });
  expect(layer.findings[0]?.message).toContain(expectedTarget);
  expect(layer.artifacts).toEqual([".web-tops/out/links/report.json"]);
}

function buildValidSite(dir: string): void {
  put(
    dir,
    "dist/index.html",
    [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<link rel="stylesheet" href="/styles/app.css?v=1">',
      '<script type="module" src="/app.js"></script>',
      "</head>",
      "<body>",
      '<a name="top">Top</a>',
      '<h1 id="intro">Home</h1>',
      '<a href="#">Back to top</a>',
      '<a href=".">Dot</a>',
      '<a href="./">DotSlash</a>',
      '<a href="#top">Top anchor</a>',
      '<a href="#intro">Same page</a>',
      '<a href="about">RelAbout</a>',
      '<a href=" /about ">TrimAbout</a>',
      '<a href="/%2Fabout">SingleSlash</a>',
      '<a href="/%2F%2Fabout">DoubleSlash</a>',
      '<a href="/docs/?tab=api#install">Docs</a>',
      '<a href="/docs/nested">NestedDir</a>',
      '<a href="docs/">RelDocsDir</a>',
      '<a href="/docs/my%20guide.html#section&amp;1">Guide</a>',
      '<img src="/img/hero.png" srcset="/img/hero-1x.png 1x, /img/hero-2x.png 2x" alt="hero">',
      '<video poster="/media/poster.jpg"><source src="/media/clip.mp4"></video>',
      '<audio src="/media/tone.mp3"></audio>',
      '<a href=" https://example.com/missing ">Ext</a>',
      '<a href="http://example.org/404">Ext2</a>',
      '<a href="//cdn.example.com/lib.js">Proto</a>',
      '<a href="mailto:hi@example.com">Mail</a>',
      '<a href="tel:+15550100">Tel</a>',
      '<a href="data:text/plain,ok">Data</a>',
      '<a href="javascript:void(0)">JS</a>',
      '<!-- <div></div> <a href="/ignored-comment/">Comment</a> -->',
      '<script>const s = "<a href=\\"/ignored-script/\\">x</a>";</script>',
      "</body></html>",
    ].join("\n"),
  );
  put(
    dir,
    "dist/docs/index.html",
    '<h2 id="install">Install</h2><a href="/about#team">RootAbout</a><a href="sub">DocsSub</a><a href="../about#team">Team</a>',
  );
  put(dir, "dist/docs/sub.html", "<h1>Sub</h1>");
  put(dir, "dist/docs/nested/index.html", "<h1>Nested</h1>");
  put(dir, "dist/docs/guide.html", '<h2 id="g1">G1</h2><a href="#g1">Self</a>');
  put(dir, "dist/docs/my guide.html", '<h2 id="section&amp;1">Section</h2>');
  put(dir, "dist/about.html", '<h2 id="team">Team</h2><a href="/">Home</a>');
  put(dir, "dist/styles/app.css", "body {}");
  put(dir, "dist/app.js", "console.log(1);");
  put(dir, "dist/img/hero.png", "png");
  put(dir, "dist/img/hero-1x.png", "png");
  put(dir, "dist/img/hero-2x.png", "png");
  put(dir, "dist/media/poster.jpg", "jpg");
  put(dir, "dist/media/clip.mp4", "mp4");
  put(dir, "dist/media/tone.mp3", "mp3");
}

describe("M4 G3: native internal link, anchor, and local asset checker", () => {
  it("passes valid internal links, clean routes, queries, encoded paths, #anchors, local assets, and external URLs", async () => {
    const { dir } = makeProject();
    buildValidSite(dir);

    const report = await runLinksGate(dir);
    expect(report.passed).toBe(true);
    expect(report.exit_code).toBe(0);
    const savedPath = join(dir, ".web-tops/out/links/report.json");
    const parsedReport: unknown = JSON.parse(readFileSync(savedPath, "utf8"));
    expect(parsedReport).toEqual({
      pages: 7,
      checked: 33,
      broken: [],
    });
    const passEntry = report.layers.find((l) => l.id === "links");
    if (passEntry === undefined) throw new Error("missing links layer");
    expect(passEntry.artifacts).toEqual([".web-tops/out/links/report.json"]);
    expect(passEntry.findings[0]).toMatchObject({
      tool: "webtops",
      rule: "links",
      verdict: "pass",
      message: "checked 33 reference(s) across 7 page(s)",
    });
  });

  it.each([
    ["broken /missing/ link", "dist/index.html", '<a href="/missing/">Missing</a>', "/missing/"],
    [
      "colon after path prefix is treated as local",
      "dist/index.html",
      '<a href="docs/v1:intro">C</a>',
      "docs/v1:intro",
    ],
    ["single parent traversal from root", "dist/index.html", '<a href="..">Parent</a>', ".."],
    [
      "direct ../ traversal from root",
      "dist/index.html",
      '<a href="../secret.html">Esc</a>',
      "../secret.html",
    ],
    [
      "parent path traversal",
      "dist/index.html",
      '<a href="../../secret.html">Esc2</a>',
      "../../secret.html",
    ],
    ["broken same-page #anchor", "dist/index.html", '<a href="#nope">No</a>', "#nope"],
    [
      "same-page #anchor on non-index page",
      "dist/about.html",
      '<a href="#bad-about">No</a>',
      "#bad-about",
    ],
    ["broken cross-page #anchor", "dist/index.html", '<a href="/docs/#bad">Bad</a>', "/docs/#bad"],
    ["missing /x.png image", "dist/index.html", '<img src="/x.png" alt="x">', "/x.png"],
    [
      "missing relative asset",
      "dist/docs/index.html",
      '<script src="local.js"></script>',
      "local.js",
    ],
    [
      "missing srcset candidate",
      "dist/index.html",
      '<img srcset="/ok.png 1x, /miss-2x.png 2x" alt="x">',
      "/miss-2x.png",
    ],
    [
      "missing video poster",
      "dist/index.html",
      '<video poster="/no-poster.jpg"></video>',
      "/no-poster.jpg",
    ],
    ["empty img src", "dist/index.html", '<img src="" alt="x">', "empty src"],
    [
      "malformed percent escape",
      "dist/index.html",
      '<a href="/bad%E0%A4%A">Bad</a>',
      "/bad%E0%A4%A",
    ],
  ])(
    "fails on planted %s naming source file and target",
    async (_label, pagePath, body, expected) => {
      const { dir } = makeProject();
      put(dir, "dist/index.html", '<h1 id="ok">OK</h1>');
      put(dir, "dist/docs.html", "<h1>Docs HTML</h1>");
      put(dir, "dist/about.html", "<h1>About</h1>");
      if (pagePath !== "dist/docs/index.html") {
        put(dir, "dist/docs/index.html", '<h1 id="ok">Docs</h1>');
      }
      put(dir, "dist/ok.png", "png");
      put(dir, pagePath, `<!doctype html>\n<html><body>\n${body}\n</body></html>\n`);

      const report = await runLinksGate(dir);
      assertFailedLink(report, pagePath.slice("dist/".length), expected);
    },
  );

  it("does not fall back to .html when an extensioned asset is missing", async () => {
    const { dir } = makeProject();
    put(dir, "dist/miss.png.html", "<h1>Not an image</h1>");
    put(
      dir,
      "dist/index.html",
      '<!doctype html>\n<html><body>\n<img src="/miss.png">\n</body></html>\n',
    );
    const report = await runLinksGate(dir);
    assertFailedLink(report, "index.html", "/miss.png");
  });

  it("does not treat /docs/ as docs.html when docs/index.html is absent", async () => {
    const { dir } = makeProject();
    put(dir, "dist/docs.html", "<h1>Docs File</h1>");
    put(
      dir,
      "dist/index.html",
      '<!doctype html>\n<html><body>\n<a href="/docs/">Docs</a>\n</body></html>\n',
    );
    const report = await runLinksGate(dir);
    assertFailedLink(report, "index.html", "/docs/");
  });

  it("fails closed when dist/ is missing and skips links cleanly as not-run", async () => {
    const { dir } = makeProject();
    const report = await runLinksGate(dir);
    expect(report.passed).toBe(false);
    expect(report.exit_code).toBe(1);
    expect(report.layers.find((l) => l.id === "build")?.verdict).toBe("fail");
    expect(report.layers.find((l) => l.id === "links")?.verdict).toBe("not-run");
    expect(existsSync(join(dir, ".web-tops/out/links/report.json"))).toBe(false);
  });

  it("fails closed with not-evaluated on 0-page dist/ (X3)", async () => {
    const { dir } = makeProject();
    put(dir, "dist/styles/app.css", "body {}");
    const zeroReport = await runLinksGate(dir);
    const linksEntry = zeroReport.layers.find((l) => l.id === "links");
    if (linksEntry === undefined) throw new Error("missing links layer");
    expect(linksEntry.verdict).toBe("not-evaluated");
    expect(linksEntry.reason).toContain("no HTML pages");
    expect(linksEntry.findings).toHaveLength(1);
    expect(linksEntry.findings[0]).toMatchObject({
      tool: "webtops",
      rule: "links",
      verdict: "not-evaluated",
      message: "no HTML pages found in built dist/ directory",
    });
    expect(linksEntry.artifacts).toEqual([".web-tops/out/links/report.json"]);
    expect(zeroReport.counts.not_evaluated).toBe(1);
    expect(zeroReport.passed).toBe(false);
    const zeroJson: unknown = JSON.parse(
      readFileSync(join(dir, ".web-tops/out/links/report.json"), "utf8"),
    );
    expect(zeroJson).toEqual({ pages: 0, checked: 0, broken: [] });
  });

  it("creates fresh nested outDir on 0-page dist/ and fails directly on missing dist/", async () => {
    const { dir } = makeProject();
    put(dir, "dist/styles/app.css", "body {}");
    const nestedOut = join(dir, "fresh/nested/out");
    const zeroDirectCtx: LayerContext = {
      cwd: dir,
      config: cfg({ class: "astro-site" }),
      base: "origin/main",
      enforce: "hard",
      env: process.env,
      exec: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
      outDir: nestedOut,
      artifacts: new Map(),
    };
    const zeroDirectRes = await linksLayer.run(zeroDirectCtx);
    await linksLayer.run(zeroDirectCtx);
    expect(zeroDirectRes.verdict).toBe("not-evaluated");
    expect(zeroDirectRes.artifacts).toEqual({
      "links-json": join(nestedOut, "links", "report.json"),
    });
    expect(existsSync(join(nestedOut, "links", "report.json"))).toBe(true);

    const missingDir = makeProject().dir;
    const missingRes = await linksLayer.run({
      ...zeroDirectCtx,
      cwd: missingDir,
      outDir: join(missingDir, ".web-tops", "out"),
    });
    expect(missingRes.verdict).toBe("fail");
    expect(missingRes.findings[0]?.verdict).toBe("fail");
    expect(missingRes.artifacts).toEqual({});
    expect(linksLayer.classes).toEqual(["ui-components", "astro-site", "web-app"]);
    expect(linksLayer.requires).toEqual(["build"]);
    expect(linksLayer.produces).toEqual(["links-json"]);
    expect(linksLayer.consumes).toEqual([{ artifact: "inventory", from: "build" }]);
  });

  it("extracts entities, quotes, tags, script/style skips, comments, and closing tags cleanly", () => {
    const html = [
      "<!doctype html>",
      "a<!-- <div></div> <a href='/comment/'>skip</a> -->b",
      "<!--<!--><a href='/after-nested-comment'></a>",
      "<a name='legacy' href='/e?q=&amp;&apos;&gt;&lt;&quot;&#x41;&#X42;&#65;&#0;&unknown;' href=/dup></a>",
      "<div name='not-anchor' href='/no-href' src='/no-src' poster='/no-poster'></div>",
      `><a title="x 'y' > z" href="/dq"></a>`,
      `<a title='x "y" > z' href='/sq'></a>`,
      '<link href="/style.css"><area href=/area-target>',
      '<audio src="/a.mp3"><source src="/b.mp4" srcset=" , /srcset.png 1x"></audio>',
      '<video src="/v.mp4" poster="/p.jpg"></video>',
      "<embed src=/embed.bin><iframe src=/frame.html></iframe><track src=/sub.vtt>",
      "</a href='/closing-tag-ignored'>",
      "<script><a href='/in-script-1'></a></script><a href='/after-script'></a>",
      "<SCRIPT><a href='/in-script-2'></a></SCRIPT ><a href='/after-upper-script'></a>",
      "<style>/* <a href='/in-style'> */</style><a href='/after-style'></a>",
      "<STYLE ><a href='/in-upper-style'></a></STYLE ><a href='/after-upper-style'></a>",
      '<div id="" disabled>5 < 6</div>',
      '<span title="unclosed"',
    ].join("\n");
    const parsed = parseHtmlPage(html);
    expect(parsed.anchors.has("legacy")).toBe(true);
    expect(parsed.anchors.has("not-anchor")).toBe(false);
    expect(parsed.anchors.has("")).toBe(false);
    expect(parsed.refs.map((r) => [r.attr, r.target])).toEqual([
      ["href", "/after-nested-comment"],
      ["href", "/e?q=&'><\"ABA&unknown;"],
      ["href", "/dq"],
      ["href", "/sq"],
      ["href", "/style.css"],
      ["href", "/area-target"],
      ["src", "/a.mp3"],
      ["src", "/b.mp4"],
      ["srcset", "/srcset.png"],
      ["src", "/v.mp4"],
      ["poster", "/p.jpg"],
      ["src", "/embed.bin"],
      ["src", "/frame.html"],
      ["src", "/sub.vtt"],
      ["href", "/after-script"],
      ["href", "/after-upper-script"],
      ["href", "/after-style"],
      ["href", "/after-upper-style"],
    ]);
  });

  it("handles unclosed comments, unclosed scripts, and comment boundary starts safely", () => {
    expect(parseHtmlPage("<!---><a href='/inside'></a>").refs).toEqual([]);
    expect(parseHtmlPage("<!-- <a href='/eof'>").refs).toEqual([]);
    expect(parseHtmlPage("x<a href='/ok'></a><script><a href='/unclosed'>").refs).toEqual([
      { line: 1, attr: "href", target: "/ok" },
    ]);
  });

  it("ignores empty href and empty fragment while failing malformed fragment encoding", async () => {
    const { dir } = makeProject();
    put(
      dir,
      "dist/index.html",
      '<a href="">Empty</a><a href="#">Hash</a><a href="./docs/#">Rel</a><a href="/missing#bad%E0%A4%A">BadFrag</a>',
    );
    put(dir, "dist/docs/index.html", "<h1>Docs</h1>");
    const report = await runLinksGate(dir);
    const entry = report.layers.find((l) => l.id === "links");
    if (entry === undefined) throw new Error("missing links entry");
    expect(entry.verdict).toBe("fail");
    expect(entry.findings).toHaveLength(1);
    expect(entry.findings[0]?.message).toContain("malformed fragment");
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
