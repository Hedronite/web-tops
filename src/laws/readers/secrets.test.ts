import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fakeExec, prepare, type Prepared } from "../../layers/hygiene/testkit.ts";
import { configArgs, isScannable, readScan, scan, secretsReader } from "./secrets.ts";
import { inputFor, lawOf } from "./testkit.ts";

const prepared: Prepared[] = [];

afterEach(() => {
  for (const item of prepared.splice(0)) {
    item.project.cleanup();
  }
});

function setup(files: Record<string, string> = {}, options = {}): Prepared {
  const item = prepare(files, options);
  prepared.push(item);
  return item;
}

const PRESET = "@secretlint/secretlint-rule-preset-recommend";
const LAW = lawOf("W-39", [{ tool: "secretlint", name: PRESET }]);

describe("isScannable", () => {
  it.each(["src/a.ts", "README.md", "web-tops.yaml", "fixtures/a.json", "src/a.PNGX"])(
    "scans %s",
    (file) => {
      expect(isScannable(file)).toBe(true);
    },
  );

  it.each(["logo.png", "a/b.JPG", "font.woff2", "x.zip", "bun.lock", "bun.lockb", "a.wasm"])(
    "does not scan %s",
    (file) => {
      expect(isScannable(file)).toBe(false);
    },
  );

  it.each([
    ".avif",
    ".eot",
    ".gif",
    ".gz",
    ".ico",
    ".jpeg",
    ".jpg",
    ".mp3",
    ".mp4",
    ".otf",
    ".pdf",
    ".png",
    ".tgz",
    ".ttf",
    ".wasm",
    ".webp",
    ".woff",
    ".woff2",
    ".zip",
  ])("does not scan a %s file", (extension) => {
    expect(isScannable(`media/file${extension}`)).toBe(false);
  });

  it("scans a file named like a lockfile in a folder", () => {
    expect(isScannable("docs/bun.lock")).toBe(true);
  });
});

describe("configArgs", () => {
  it("writes the recommended preset into the run's directory when the project keeps no config", () => {
    const item = setup();
    const args = configArgs(item.project.dir, item.outDir);
    const path = join(item.outDir, "laws", "secretlintrc.json");
    expect(args).toEqual(["--secretlintrc", path]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      rules: [{ id: "@secretlint/secretlint-rule-preset-recommend" }],
    });
  });

  it("makes the run's directory when it is not there yet", () => {
    const item = setup();
    const outDir = join(item.outDir, "deeper", "still");
    configArgs(item.project.dir, outDir);
    expect(existsSync(join(outDir, "laws", "secretlintrc.json"))).toBe(true);
  });

  it("names no config when the project keeps its own", () => {
    const item = setup({ ".secretlintrc.json": '{"rules":[]}' });
    expect(configArgs(item.project.dir, item.outDir)).toEqual([]);
  });
});

describe("readScan", () => {
  const output = JSON.stringify([
    {
      filePath: "/p/src/bad.ts",
      sourceContentType: "text",
      messages: [
        {
          message: "found AWS Secret Access Key: ****",
          ruleId: "@secretlint/secretlint-rule-aws",
          loc: { start: { line: 3, column: 4 }, end: { line: 3, column: 9 } },
          severity: "error",
        },
        { message: "no place", ruleId: "r" },
      ],
    },
    { filePath: "/p/src/clean.ts", sourceContentType: "text", messages: [] },
  ]);

  it("reads one finding for each message, in the file's place, without the secret", () => {
    expect(readScan("/p", output)).toEqual([
      {
        tool: "secretlint",
        rule: "secretlint:@secretlint/secretlint-rule-aws",
        verdict: "refuse",
        message: "found AWS Secret Access Key: ****",
        file: "src/bad.ts",
        line: 3,
      },
      {
        tool: "secretlint",
        rule: "secretlint:r",
        verdict: "refuse",
        message: "no place",
        file: "src/bad.ts",
      },
    ]);
  });

  it.each(["", "not json", "{}", '"x"'])("is undefined for %j", (text) => {
    expect(readScan("/p", text)).toBeUndefined();
  });
});

describe("scan: the tracked text files, in batches", () => {
  it("runs the scanner on batches of 100 files, with the config and the JSON format, and skips binaries", async () => {
    const item = setup();
    const tracked = [
      ...Array.from({ length: 250 }, (_, index) => `src/f${String(index)}.ts`),
      "logo.png",
      "bun.lock",
    ];
    const fake = fakeExec(item.project.dir, {
      secretlint: () => ({ code: 0, stdout: "[]", stderr: "" }),
    });
    const done = await scan({
      ...inputFor([LAW], { cwd: item.project.dir, tracked }),
      ctx: {
        ...inputFor([LAW]).ctx,
        cwd: item.project.dir,
        outDir: item.outDir,
        exec: fake.exec,
      },
    });
    expect(done).toEqual({ findings: [] });
    const config = join(item.outDir, "laws", "secretlintrc.json");
    expect(fake.calls.map((call) => call.args.length - 4)).toEqual([100, 100, 50]);
    expect(fake.calls[0]?.args.slice(0, 5)).toEqual([
      "--secretlintrc",
      config,
      "--format",
      "json",
      "src/f0.ts",
    ]);
  });

  it("runs nothing for a project with nothing to scan", async () => {
    const item = setup();
    const fake = fakeExec(item.project.dir);
    const base = inputFor([LAW], { cwd: item.project.dir, tracked: ["logo.png"] });
    const done = await scan({
      ...base,
      ctx: { ...base.ctx, outDir: item.outDir, exec: fake.exec },
    });
    expect(done).toEqual({ findings: [] });
    expect(fake.calls).toEqual([]);
  });

  it("a project with nothing to scan reads as a pass that says 0 files were scanned, not as a scan that found nothing", async () => {
    const item = setup();
    const base = inputFor([LAW], { cwd: item.project.dir, tracked: ["logo.png", "bun.lock"] });
    const readings = await secretsReader({
      ...base,
      ctx: { ...base.ctx, outDir: item.outDir, exec: fakeExec(item.project.dir).exec },
    });
    expect(readings).toEqual([
      {
        law: "W-39",
        verdict: "pass",
        findings: [],
        note: "0 files scanned: no tracked file can hold a secret",
      },
    ]);
  });

  it.each([
    [
      "exits with an error",
      { code: 2, stdout: "", stderr: "boom\nbang\n" },
      "secretlint exited 2 and gave no scan: boom\nbang",
    ],
    [
      "prints no JSON",
      { code: 0, stdout: "not json", stderr: "" },
      "secretlint exited 0 and gave no scan: not json",
    ],
  ])("gives no answer when the scanner %s", async (_name, result, reason) => {
    const item = setup();
    const fake = fakeExec(item.project.dir, { secretlint: () => result });
    const base = inputFor([LAW], { cwd: item.project.dir, tracked: ["src/a.ts"] });
    expect(
      await scan({ ...base, ctx: { ...base.ctx, outDir: item.outDir, exec: fake.exec } }),
    ).toEqual({
      reason,
    });
  });

  it("stops at the first batch that gave no answer", async () => {
    const item = setup();
    const fake = fakeExec(item.project.dir, {
      secretlint: () => ({ code: 2, stdout: "", stderr: "x" }),
    });
    const tracked = Array.from({ length: 150 }, (_, index) => `src/f${String(index)}.ts`);
    const base = inputFor([LAW], { cwd: item.project.dir, tracked });
    await scan({ ...base, ctx: { ...base.ctx, outDir: item.outDir, exec: fake.exec } });
    expect(fake.calls).toHaveLength(1);
  });

  it("gives no answer when secretlint is not installed, and says so", async () => {
    const item = setup({}, { without: ["secretlint"] });
    const base = inputFor([LAW], { cwd: item.project.dir, tracked: ["src/a.ts"] });
    const done = await scan({ ...base, ctx: { ...base.ctx, outDir: item.outDir } });
    expect(done).toEqual({
      reason:
        "secretlint exited null and gave no scan: secretlint is not installed in node_modules (package secretlint)",
    });
  });
});

describe("secretsReader with no scanner installed", () => {
  it("is not evaluated when the scanner gave no answer", async () => {
    const item = setup({}, { without: ["secretlint"] });
    const base = inputFor([LAW], { cwd: item.project.dir, tracked: ["src/a.ts"] });
    const readings = await secretsReader({ ...base, ctx: { ...base.ctx, outDir: item.outDir } });
    expect(readings[0]?.verdict).toBe("not-evaluated");
  });
});

describe("secretsReader over what the scanner said", () => {
  /** What secretlint prints: one finding in the first file of the batch it was given, by its path in the project. */
  const leakInFirst = (dir: string, args: readonly string[]): string => {
    const first = args[4] ?? "";
    return JSON.stringify([
      {
        filePath: join(realpathSync(dir), first),
        messages: [{ message: `in ${first}`, ruleId: "r", loc: { start: { line: 1 } } }],
      },
    ]);
  };

  function inputOver(item: Prepared, tracked: readonly string[], held: boolean) {
    const fake = fakeExec(item.project.dir, {
      secretlint: (args, dir) => ({ code: 1, stdout: leakInFirst(dir, args), stderr: "" }),
    });
    const base = inputFor([LAW], { cwd: item.project.dir, tracked, held });
    return { ...base, ctx: { ...base.ctx, outDir: item.outDir, exec: fake.exec } };
  }

  it("keeps the findings of every batch, and a pass of its own says nothing about a scan of nothing", async () => {
    const item = setup();
    const tracked = Array.from({ length: 150 }, (_, index) => `src/f${String(index)}.ts`);
    const done = await scan(inputOver(item, tracked, false));
    expect("findings" in done ? done.findings.map((finding) => finding.file) : []).toEqual([
      "src/f0.ts",
      "src/f100.ts",
    ]);
  });

  it("refuses a law over the findings even under a ratchet: gate 1 counts no secret, so no baseline holds it", async () => {
    const item = setup();
    const readings = await secretsReader(inputOver(item, ["src/a.ts"], true));
    expect(readings[0]).toMatchObject({ law: "W-39", verdict: "refuse" });
    expect(readings[0]?.findings).toHaveLength(1);
  });

  it("a scan of files that finds nothing is a plain pass, with no note about nothing scanned", async () => {
    const item = setup();
    const fake = fakeExec(item.project.dir, {
      secretlint: () => ({ code: 0, stdout: "[]", stderr: "" }),
    });
    const base = inputFor([LAW], { cwd: item.project.dir, tracked: ["src/a.ts"] });
    const readings = await secretsReader({
      ...base,
      ctx: { ...base.ctx, outDir: item.outDir, exec: fake.exec },
    });
    expect(readings).toEqual([{ law: "W-39", verdict: "pass", findings: [] }]);
  });
});
