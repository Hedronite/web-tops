import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fakeHost, madeDirs, put, tempDir } from "../init/test-support.ts";
import { NODE_RANGE } from "../lock/pins.ts";
import type { Probe, Setup } from "./doctor.ts";
import { diagnose, runDoctorCli } from "./doctor.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const GOOD: Probe = { bun: "1.4.4", node: "24.22.3", typescript: "6.0.3", chromium: "present" };
const SETUP: Setup = { className: "ts-library", typescript: "6.0.3", nodeRange: NODE_RANGE };

const missing = (probe: Probe, setup: Setup): string[] =>
  diagnose(probe, setup)
    .filter((check) => check.status === "missing")
    .map((check) => check.name);

describe("doctor diagnose", () => {
  it("finds nothing missing on a good host, for every class", () => {
    for (const className of [
      "ts-library",
      "ui-components",
      "astro-site",
      "web-app",
      "node-service",
    ]) {
      expect(missing(GOOD, { ...SETUP, className }), className).toEqual([]);
    }
  });

  it.each([["1.3.9"], [undefined]])("finds Bun %s missing", (bun) => {
    expect(missing({ ...GOOD, bun }, SETUP)).toEqual(["bun"]);
  });

  it.each([
    ["22.23.3", false],
    ["22.23.4", true],
    ["23.0.0", false],
    ["24.14.9", false],
    ["24.15.0", true],
    ["25.9.9", false],
    ["26.0.0", true],
  ])("Node %s inside the range: %s", (node, inside) => {
    expect(missing({ ...GOOD, node }, SETUP)).toEqual(inside ? [] : ["node"]);
  });

  it.each(["ts-library", "ui-components", "astro-site", "web-app", "node-service"])(
    "needs Node in the range for %s too, because the tools are Node programs",
    (className) => {
      expect(missing({ ...GOOD, node: "22.9.0" }, { ...SETUP, className })).toEqual(["node"]);
      expect(missing({ ...GOOD, node: undefined }, { ...SETUP, className })).toEqual(["node"]);
    },
  );

  it("checks Node against the range the setup carries, not a fixed one", () => {
    expect(missing({ ...GOOD, node: "24.22.3" }, { ...SETUP, nodeRange: ">=26" })).toEqual([
      "node",
    ]);
    expect(missing({ ...GOOD, node: "26.1.0" }, { ...SETUP, nodeRange: ">=26" })).toEqual([]);
  });

  it("does not check Node when no lock records a range, and says so", () => {
    const setup: Setup = { ...SETUP, nodeRange: undefined };
    expect(missing({ ...GOOD, node: "18.0.0" }, setup)).toEqual([]);
    expect(missing({ ...GOOD, node: undefined }, setup)).toEqual([]);
    const node = diagnose(GOOD, setup).find((check) => check.name === "node");
    expect(node?.status).toBe("info");
    expect(node?.detail).toContain("not checked");
    expect(node?.detail).toContain("24.22.3");
  });

  it("says in the Node line which version was found and which range is needed", () => {
    const node = diagnose({ ...GOOD, node: "22.9.0" }, SETUP).find(
      (check) => check.name === "node",
    );
    expect(node?.detail).toContain("22.9.0");
    expect(node?.detail).toContain(NODE_RANGE);
    const none = diagnose({ ...GOOD, node: undefined }, SETUP).find(
      (check) => check.name === "node",
    );
    expect(none?.detail).toContain("not found");
  });

  it("finds TypeScript missing when absent or not the pin", () => {
    expect(missing({ ...GOOD, typescript: "6.0.2" }, SETUP)).toEqual(["typescript"]);
    expect(missing({ ...GOOD, typescript: undefined }, SETUP)).toEqual(["typescript"]);
    expect(missing({ ...GOOD, typescript: "6.0.2" }, { ...SETUP, typescript: "6.0.2" })).toEqual(
      [],
    );
  });

  it.each(["ui-components", "astro-site", "web-app"])(
    "needs a Playwright browser for %s",
    (className) => {
      expect(missing({ ...GOOD, chromium: "missing" }, { ...SETUP, className })).toEqual([
        "playwright",
      ]);
      expect(missing({ ...GOOD, chromium: "not-installed" }, { ...SETUP, className })).toEqual([
        "playwright",
      ]);
    },
  );

  it.each(["ts-library", "node-service"])(
    "does not need a Playwright browser for %s",
    (className) => {
      expect(missing({ ...GOOD, chromium: "missing" }, { ...SETUP, className })).toEqual([]);
    },
  );

  it("says Playwright was not checked when there is no class", () => {
    const checks = diagnose({ ...GOOD, chromium: "missing" }, { ...SETUP, className: undefined });
    const playwright = checks.find((c) => c.name === "playwright");
    expect(playwright?.status).toBe("info");
    expect(playwright?.detail).toContain("not checked");
  });
});

describe("webtops doctor", () => {
  async function cli(argv: readonly string[], cwd: string, env: Record<string, string>) {
    let out = "";
    let err = "";
    const code = await runDoctorCli(argv, {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
      cwd,
      env,
    });
    return { code, out, err };
  }

  const goodHost = (): Record<string, string> => fakeHost({ bun: "1.4.4", node: "v24.22.3" });

  function project(className: string, revision: string | null = "1234"): string {
    const dir = tempDir();
    put(
      dir,
      "web-tops.yaml",
      `class: ${className}\ntoolchain:\n  typescript: "6.0.3"\n  runtime: bun\n`,
    );
    put(dir, "web-tops.lock", `node: "${NODE_RANGE}"\ntypescript: 6.0.3\n`);
    put(dir, "node_modules/typescript/package.json", JSON.stringify({ version: "6.0.3" }));
    put(dir, "node_modules/@playwright/test/package.json", JSON.stringify({ version: "1.65.1" }));
    if (revision !== null) {
      put(
        dir,
        "node_modules/playwright-core/browsers.json",
        JSON.stringify({ browsers: [{ name: "chromium", revision }] }),
      );
    }
    return dir;
  }

  it("exits 0 on a good host for a class that needs no browser", async () => {
    const env = { ...goodHost(), PLAYWRIGHT_BROWSERS_PATH: tempDir() };
    const { code, out, err } = await cli([], project("ts-library"), env);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("every requirement is met");
  });

  it("exits 3 when a Playwright browser is missing for a class that needs it", async () => {
    const env = { ...goodHost(), PLAYWRIGHT_BROWSERS_PATH: tempDir() };
    const { code, out } = await cli([], project("astro-site"), env);
    expect(code).toBe(3);
    expect(out).toMatch(/missing\s+playwright/i);
  });

  it("exits 0 when the browser for the installed Playwright is there", async () => {
    const browsers = tempDir();
    put(browsers, "chromium-1234/INSTALLATION_COMPLETE", "");
    const env = { ...goodHost(), PLAYWRIGHT_BROWSERS_PATH: browsers };
    expect((await cli([], project("web-app"), env)).code).toBe(0);
  });

  it("exits 3 when TypeScript is not the pinned version", async () => {
    const dir = project("ts-library");
    put(dir, "node_modules/typescript/package.json", JSON.stringify({ version: "6.0.2" }));
    expect((await cli([], dir, goodHost())).code).toBe(3);
  });

  it.each([
    ["22.23.3", 3],
    ["22.23.4", 0],
    ["23.5.0", 3],
    ["24.14.9", 3],
    ["24.15.0", 0],
    ["25.0.0", 3],
    ["26.0.0", 0],
  ])("with Node %s on the PATH exits %i, against the range in the lock", async (node, expected) => {
    const env = fakeHost({ bun: "1.4.4", node: `v${node}` });
    expect((await cli([], project("ts-library"), env)).code).toBe(expected);
  });

  it("exits 3 and names node when Node is outside the range", async () => {
    const env = fakeHost({ bun: "1.4.4", node: "v22.23.3" });
    const { code, out, err } = await cli([], project("ts-library"), env);
    expect(code).toBe(3);
    expect(out).toMatch(/missing\s+node/);
    expect(out).toContain("22.23.3");
    expect(err).toContain("1 requirement missing");
  });

  it("exits 3 when there is no Node on the PATH", async () => {
    const env = fakeHost({ bun: "1.4.4" });
    expect((await cli([], project("ts-library"), env)).code).toBe(3);
  });

  it("reads the Node range from web-tops.lock when it records one", async () => {
    const dir = project("ts-library");
    put(dir, "web-tops.lock", 'node: ">=26"\ntypescript: 6.0.3\n');
    expect((await cli([], dir, fakeHost({ bun: "1.4.4", node: "v24.22.3" }))).code).toBe(3);
    expect((await cli([], dir, fakeHost({ bun: "1.4.4", node: "v26.0.0" }))).code).toBe(0);
  });

  it("exits 2 with the fix when the lock records no node range, never falling back to a range of its own", async () => {
    const dir = project("ts-library");
    put(dir, "web-tops.lock", "typescript: 6.0.3\n");
    const { code, err } = await cli([], dir, goodHost());
    expect(code).toBe(2);
    expect(err).toContain("web-tops.lock has no node range; run webtops lock --update");
    expect((await cli([], dir, fakeHost({ bun: "1.4.4" }))).code).toBe(2);
  });

  it("does not check Node when there is no lock, and exits 0 on an otherwise good host", async () => {
    const dir = project("ts-library");
    rmSync(join(dir, "web-tops.lock"));
    const { code, out } = await cli([], dir, fakeHost({ bun: "1.4.4", node: "v18.0.0" }));
    expect(code).toBe(0);
    expect(out).toMatch(/info\s+node\s+18\.0\.0; not checked/);
  });

  it("exits 2 when web-tops.lock cannot be read", async () => {
    const dir = project("ts-library");
    put(dir, "web-tops.lock", "typescript: ^6\n");
    const { code, err } = await cli([], dir, goodHost());
    expect(code).toBe(2);
    expect(err).toContain("web-tops.lock");
  });

  it("says a lock that is not YAML is unusable once, not once per layer of the code", async () => {
    const dir = project("ts-library");
    put(dir, "web-tops.lock", "a: [unclosed\n");
    const { code, err } = await cli([], dir, goodHost());
    expect(code).toBe(2);
    expect(err.split("web-tops.lock is unusable").length - 1).toBe(1);
    expect(err.startsWith("webtops doctor: web-tops.lock is unusable: ")).toBe(true);
  });

  it("prints the missing node range message as it is, with no prefix", async () => {
    const dir = project("ts-library");
    put(dir, "web-tops.lock", "typescript: 6.0.3\n");
    const { err } = await cli([], dir, goodHost());
    expect(err).toBe(
      "webtops doctor: web-tops.lock has no node range; run webtops lock --update\n",
    );
  });

  it("checks Bun, Node and TypeScript only, and never writes, with no web-tops.yaml", async () => {
    const dir = tempDir();
    put(dir, "node_modules/typescript/package.json", JSON.stringify({ version: "6.0.3" }));
    const { code, out } = await cli([], dir, goodHost());
    expect(code).toBe(0);
    expect(out).toContain("not checked");
  });

  it("exits 2 when web-tops.yaml cannot be read for its class", async () => {
    const dir = tempDir();
    put(dir, "web-tops.yaml", "a: [unclosed\n");
    expect((await cli([], dir, goodHost())).code).toBe(2);
    const noClass = tempDir();
    put(noClass, "web-tops.yaml", "version: 1\n");
    expect((await cli([], noClass, goodHost())).code).toBe(2);
  });

  it("exits 2 for an argument", async () => {
    const { code, err } = await cli(["--fix"], tempDir(), goodHost());
    expect(code).toBe(2);
    expect(err).toContain("usage: webtops doctor");
  });

  it("does not install or write anything", async () => {
    const dir = project("astro-site");
    await cli([], dir, { ...goodHost(), PLAYWRIGHT_BROWSERS_PATH: join(dir, "nowhere") });
    expect(existsSync(join(dir, "nowhere"))).toBe(false);
  });
});
