import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanRepos, git, makeRepo, write } from "../diff/test-support.ts";
import type { Io } from "./io.ts";
import { runBaselineCli } from "./baseline.ts";
import { run } from "./main.ts";

afterEach(cleanRepos);

const source: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../fixtures/report/shape/with-metrics.json"), "utf8"),
);

const YAML = (enforce: string): string =>
  `protocol: "0.3.0"\nversion: "1"\npackage: fixture\nclass: ts-library\nenforce: ${enforce}\nbaseline: .web-tops/baseline.json\n`;

function runOf(base: object): object {
  const run: unknown = Reflect.get(base, "run");
  return typeof run === "object" && run !== null ? run : {};
}

function project(enforce = "ratchet"): string {
  const dir = makeRepo({
    "web-tops.yaml": YAML(enforce),
    ".gitignore": ".web-tops/report.json\n",
    "src/a.ts": "export const a = 1;\n",
  });
  const base = typeof source === "object" && source !== null ? source : {};
  const report = {
    ...base,
    enforce: "advisory",
    enforced: false,
    passed: true,
    exit_code: 0,
    run: { ...runOf(base), sha: git(dir, "rev-parse", "HEAD") },
  };
  write(dir, { ".web-tops/report.json": JSON.stringify(report) });
  return dir;
}

function io(cwd: string): { io: Io; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
      cwd,
      env: {},
    },
    out: () => out,
    err: () => err,
  };
}

describe("G9a: the baseline command", () => {
  it("writes the baseline from the last report and says what it holds, exit 0", async () => {
    const dir = project();
    const streams = io(dir);
    expect(await runBaselineCli([], streams.io)).toBe(0);
    expect(streams.out()).toMatch(
      /^wrote \.web-tops\/baseline\.json: \d+ functions?, \d+ packages?, \d+ findings?/,
    );
    expect(existsSync(join(dir, ".web-tops/baseline.json"))).toBe(true);
  });

  it("refuses with the reason on stderr and exit 2, writing nothing", async () => {
    const dir = project();
    write(dir, { "src/a.ts": "export const a = 2;\n" });
    const streams = io(dir);
    expect(await runBaselineCli([], streams.io)).toBe(2);
    expect(streams.out()).toBe("");
    expect(streams.err()).toMatch(/^webtops baseline: /);
    expect(existsSync(join(dir, ".web-tops/baseline.json"))).toBe(false);
  });

  it("refuses a repo that runs hard, and a missing web-tops.yaml, and arguments", async () => {
    const hard = io(project("hard"));
    expect(await runBaselineCli([], hard.io)).toBe(2);
    expect(hard.err()).toMatch(/hard/);
    const bare = io(makeRepo({ "src/a.ts": "export {};\n" }));
    expect(await runBaselineCli([], bare.io)).toBe(2);
    const args = io(project());
    expect(await runBaselineCli(["--force"], args.io)).toBe(2);
    expect(args.err()).toMatch(/usage/);
  });

  it("prints its usage for --help, and is a command of webtops", async () => {
    const help = io(project());
    expect(await runBaselineCli(["--help"], help.io)).toBe(0);
    expect(help.out()).toMatch(/usage: webtops baseline/);
    const streams = io(project());
    expect(await run(["baseline"], streams.io)).toBe(0);
    const usage = io(project());
    await run([], usage.io);
    expect(usage.err()).toContain("baseline");
  });
});
