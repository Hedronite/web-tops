import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildReport } from "../config/test-support-report.ts";
import { madeDirs, put, tempDir } from "../init/test-support.ts";
import { formatText } from "../report/text.ts";
import { runReportCli } from "./report.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const sample = () => buildReport({ tests: "Refuse", coverage: "not-evaluated", crap: "skip" });

async function cli(argv: readonly string[], cwd: string) {
  let out = "";
  let err = "";
  const code = await runReportCli(argv, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
    env: {},
  });
  return { code, out, err };
}

function projectWithReport(path = ".web-tops/report.json", config?: string): string {
  const dir = tempDir();
  put(dir, path, JSON.stringify(sample()));
  if (config !== undefined) put(dir, "web-tops.yaml", config);
  return dir;
}

describe("webtops report", () => {
  it("prints the text rendering by default and exits 0 even though the stored gate failed", async () => {
    const { code, out, err } = await cli([], projectWithReport());
    expect(sample().passed).toBe(false);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toBe(formatText(sample()));
  });

  it.each([["--format", "text"], ["--format=text"]])("accepts %s", async (...argv) => {
    const { code, out } = await cli(argv, projectWithReport());
    expect(code).toBe(0);
    expect(out).toBe(formatText(sample()));
  });

  it.each([["--format", "json"], ["--format=json"]])(
    "prints the stored report as json with %s",
    async (...argv) => {
      const { code, out } = await cli(argv, projectWithReport());
      expect(code).toBe(0);
      expect(JSON.parse(out)).toEqual(sample());
    },
  );

  it("writes nothing: the stored file is as the gate left it", async () => {
    const dir = projectWithReport();
    await cli([], dir);
    await cli(["--format", "json"], dir);
    expect(readFileSync(join(dir, ".web-tops/report.json"), "utf8")).toBe(JSON.stringify(sample()));
  });

  it("reads the path named by report.path in web-tops.yaml", async () => {
    const dir = projectWithReport("out/last.json", "report:\n  path: out/last.json\n");
    expect((await cli([], dir)).code).toBe(0);
  });

  it("falls back to the default path when web-tops.yaml names none", async () => {
    const dir = projectWithReport(".web-tops/report.json", "class: ts-library\n");
    expect((await cli([], dir)).code).toBe(0);
  });

  it("exits 2 and says to run the gate when there is no report", async () => {
    const { code, out, err } = await cli([], tempDir());
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("webtops gate");
  });

  it("exits 2 for an empty report file", async () => {
    const dir = tempDir();
    put(dir, ".web-tops/report.json", "");
    expect((await cli([], dir)).code).toBe(2);
  });

  it("exits 2 for a report that fails validation, naming the pointer", async () => {
    const dir = tempDir();
    put(dir, ".web-tops/report.json", JSON.stringify({ ...sample(), passed: true }));
    const { code, err } = await cli([], dir);
    expect(code).toBe(2);
    expect(err).toContain("/passed");
  });

  it.each([["--format", "yaml"], ["--format"], ["--wat"], ["extra"], ["--format", "json", "x"]])(
    "exits 2 for the arguments %j",
    async (...argv) => {
      const { code, err } = await cli(argv, projectWithReport());
      expect(code).toBe(2);
      expect(err).toContain("usage: webtops report");
    },
  );
});

describe("webtops report, the report path (R25 F3)", () => {
  it.each([
    ["a path that climbs out of the config directory", "../elsewhere.json"],
    ["an absolute path outside it", "/tmp/elsewhere.json"],
    ["the directory itself", "."],
    ["an empty path", '""'],
  ])("exits 2 at /report/path for %s, and reads nothing", async (_name, path) => {
    const dir = projectWithReport(".web-tops/report.json", `report:\n  path: ${path}\n`);
    const { code, out, err } = await cli([], dir);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("/report/path");
  });

  it("does not read a report that a climbing path points at, even when it is a valid report", async () => {
    const parent = tempDir();
    put(parent, "elsewhere.json", JSON.stringify(sample()));
    put(parent, "project/web-tops.yaml", "report:\n  path: ../elsewhere.json\n");
    const { code, out } = await cli([], join(parent, "project"));
    expect(code).toBe(2);
    expect(out).toBe("");
  });

  it.each(["web-tops.yaml", "web-tops.lock", "package.json"])(
    "exits 2 at /report/path for report.path %s, a file the kit must not read as a report",
    async (path) => {
      const dir = projectWithReport(".web-tops/report.json", `report:\n  path: ${path}\n`);
      put(dir, "package.json", "{}");
      const { code, err } = await cli([], dir);
      expect(code).toBe(2);
      expect(err).toContain("/report/path");
    },
  );

  it("accepts a nested path inside the config directory", async () => {
    const dir = projectWithReport("a/b/r.json", "report:\n  path: ./a/b/../b/r.json\n");
    expect((await cli([], dir)).code).toBe(0);
  });

  it("exits 2 for a report.path that is not text", async () => {
    const dir = projectWithReport(".web-tops/report.json", "report:\n  path: 3\n");
    const { code, err } = await cli([], dir);
    expect(code).toBe(2);
    expect(err).toContain("/report/path");
  });

  it("exits 2 for a web-tops.yaml that is not YAML", async () => {
    const dir = projectWithReport(".web-tops/report.json", "a: [unclosed\n");
    const { code, err } = await cli([], dir);
    expect(code).toBe(2);
    expect(err).toContain("web-tops.yaml");
  });
});
