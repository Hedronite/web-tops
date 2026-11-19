import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { fakeHost, madeDirs, put, tempDir } from "../init/test-support.ts";
import { NODE_RANGE } from "../lock/pins.ts";
import type { Check, Probe, Setup } from "./doctor.ts";
import { diagnose, runDoctorCli } from "./doctor.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const GOOD: Probe = { bun: "1.4.4", node: "24.22.3", typescript: "6.0.3", chromium: "present" };
const SETUP: Setup = { className: "ts-library", typescript: "6.0.3", nodeRange: NODE_RANGE };

const line = (probe: Probe, setup: Setup, name: string): Check | undefined =>
  diagnose(probe, setup).find((check) => check.name === name);

describe("doctor: the Bun line", () => {
  it("names the version found and the floor", () => {
    expect(line(GOOD, SETUP, "bun")).toEqual({
      name: "bun",
      status: "ok",
      detail: "1.4.4 (needs >= 1.4.0)",
    });
  });

  it("accepts the floor itself", () => {
    expect(line({ ...GOOD, bun: "1.4.0" }, SETUP, "bun")?.status).toBe("ok");
  });

  it("says not found when there is no Bun", () => {
    expect(line({ ...GOOD, bun: undefined }, SETUP, "bun")).toEqual({
      name: "bun",
      status: "missing",
      detail: "not found (needs >= 1.4.0)",
    });
  });
});

describe("doctor: the TypeScript line", () => {
  it("says the pin when it is installed", () => {
    expect(line(GOOD, SETUP, "typescript")).toEqual({
      name: "typescript",
      status: "ok",
      detail: "6.0.3 (the pin)",
    });
  });

  it("says what is installed and what the pin is", () => {
    expect(line({ ...GOOD, typescript: "6.0.2" }, SETUP, "typescript")).toEqual({
      name: "typescript",
      status: "missing",
      detail: "6.0.2, the pin is 6.0.3",
    });
  });

  it("says not installed when TypeScript is absent", () => {
    expect(line({ ...GOOD, typescript: undefined }, SETUP, "typescript")).toEqual({
      name: "typescript",
      status: "missing",
      detail: "not installed, the pin is 6.0.3",
    });
  });
});

describe("doctor: the Playwright line", () => {
  const browser = (probe: Partial<Probe>, className: string | undefined): Check | undefined =>
    line({ ...GOOD, ...probe }, { ...SETUP, className }, "playwright");

  it("says no class was named", () => {
    expect(browser({}, undefined)).toEqual({
      name: "playwright",
      status: "info",
      detail: "not checked: no web-tops.yaml names a class",
    });
  });

  it("says a class that needs no browser needs none", () => {
    expect(browser({ chromium: "missing" }, "ts-library")).toEqual({
      name: "playwright",
      status: "info",
      detail: "not required for ts-library",
    });
  });

  it("says the browser is present", () => {
    expect(browser({}, "astro-site")).toEqual({
      name: "playwright",
      status: "ok",
      detail: "chromium browser present",
    });
  });

  it("says what is missing and which class needs it", () => {
    expect(browser({ chromium: "missing" }, "astro-site")).toEqual({
      name: "playwright",
      status: "missing",
      detail:
        "its chromium browser is not downloaded (bunx playwright install chromium); astro-site needs it",
    });
    expect(browser({ chromium: "not-installed" }, "web-app")).toEqual({
      name: "playwright",
      status: "missing",
      detail: "@playwright/test is not installed; web-app needs it",
    });
  });
});

describe("webtops doctor: what it prints", () => {
  async function run(cwd: string, env: Record<string, string>) {
    let out = "";
    let err = "";
    const code = await runDoctorCli([], {
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

  function project(yaml: string, installed = "6.0.3"): string {
    const dir = tempDir();
    put(dir, "web-tops.yaml", yaml);
    put(dir, "web-tops.lock", `node: "${NODE_RANGE}"\n`);
    put(dir, "node_modules/typescript/package.json", JSON.stringify({ version: installed }));
    return dir;
  }

  const host = (): Record<string, string> => fakeHost({ bun: "1.4.4", node: "v24.22.3" });

  it("refuses a web-tops.yaml whose class is empty, and one with no class, by name", async () => {
    for (const yaml of ['class: ""\n', "version: 1\n"]) {
      const { code, out, err } = await run(project(yaml), host());
      expect(code).toBe(2);
      expect(out).toBe("");
      expect(err).toBe("webtops doctor: web-tops.yaml names no class\n");
    }
  });

  it("refuses a web-tops.yaml that is not YAML, saying so", async () => {
    const { code, err } = await run(project("a: [unclosed\n"), host());
    expect(code).toBe(2);
    expect(err.startsWith("webtops doctor: web-tops.yaml is not valid YAML: ")).toBe(true);
  });

  it("checks TypeScript against the pin web-tops.yaml names, not the kit's own", async () => {
    const yaml = 'class: ts-library\ntoolchain:\n  typescript: "6.0.2"\n';
    const { code, out } = await run(project(yaml, "6.0.2"), host());
    expect(code).toBe(0);
    expect(out).toContain("ok       typescript  6.0.2 (the pin)\n");
  });

  it("prints one line per check, then the verdict", async () => {
    const { code, out } = await run(project("class: ts-library\n"), host());
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "ok       bun         1.4.4 (needs >= 1.4.0)",
        `ok       node        24.22.3 (needs ${NODE_RANGE})`,
        "ok       typescript  6.0.3 (the pin)",
        "info     playwright  not required for ts-library",
        "doctor: every requirement is met",
        "",
      ].join("\n"),
    );
  });

  it("says one requirement in the singular and two in the plural", async () => {
    const dir = project("class: ts-library\n");
    const one = await run(dir, fakeHost({ bun: "1.4.4" }));
    expect(one.code).toBe(3);
    expect(one.err).toBe("doctor: 1 requirement missing\n");
    const two = await run(dir, fakeHost({}));
    expect(two.code).toBe(3);
    expect(two.err).toBe("doctor: 2 requirements missing\n");
  });
});
