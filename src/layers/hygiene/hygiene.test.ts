import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cfg, off, opts, tickingClock } from "../../gate/testkit.ts";
import { runGate } from "../../gate/runner.ts";
import { HYGIENE_STEPS } from "../../gate/types.ts";
import { hygieneLayer } from "./index.ts";
import {
  fakeExec,
  prepare,
  recorded,
  runHygiene,
  toolKey,
  type Fake,
  type Prepared,
} from "./testkit.ts";

const prepared: Prepared[] = [];

afterEach(() => {
  for (const item of prepared.splice(0)) {
    item.project.cleanup();
  }
});

function setup(files: Record<string, string> = {}): Prepared {
  const item = prepare(files);
  prepared.push(item);
  return item;
}

const PACKAGE = JSON.stringify({
  name: "pkg",
  version: "1.0.0",
  type: "module",
  exports: { ".": "./dist/index.js" },
});

function sequence(fake: Fake): string[] {
  return fake.calls.map((call) => toolKey(call.tool, call.args));
}

function skipped(result: Awaited<ReturnType<typeof runHygiene>>): string[] {
  return result.findings
    .filter((finding) => finding.verdict === "skip")
    .map((finding) => finding.rule);
}

describe("G3a hygiene: each tool runs once per gate; ESLint JSON kept on disk", () => {
  it("runs tsc as tsc -b --noEmit and bun audit as audit --prod --json, with nothing else", async () => {
    const item = setup({ "package.json": PACKAGE });
    const fake = fakeExec(item.project.dir);
    await runHygiene(item, fake.exec);
    expect(fake.calls.find((call) => call.tool === "tsc")?.args).toEqual(["-b", "--noEmit"]);
    const audit = fake.calls.find((call) => toolKey(call.tool, call.args) === "bun audit");
    expect(audit?.args).toEqual(["audit", "--prod", "--json"]);
    const install = fake.calls.find((call) => toolKey(call.tool, call.args) === "bun install");
    expect(install?.args).toEqual(["install", "--frozen-lockfile"]);
  });

  it("declares eslint-json, and the report lists it, so the laws layer can name its input", async () => {
    expect(hygieneLayer.produces).toEqual(
      expect.arrayContaining([
        "eslint-json",
        "audit-json",
        "stylelint-json",
        "dependency-cruiser-json",
      ]),
    );
    const item = setup({ "package.json": PACKAGE });
    const fake = fakeExec(item.project.dir);
    const steps = Object.fromEntries(
      HYGIENE_STEPS.filter((step) => step !== "eslint").map((step) => [
        step,
        off("not under test"),
      ]),
    );
    const report = await runGate({
      layers: [hygieneLayer],
      config: cfg({ hygiene: { auditFailOn: "high", steps } }),
      options: opts(),
      cwd: item.project.dir,
      env: { PATH: "/usr/bin" },
      exec: fake.exec,
      outDir: item.outDir,
      now: tickingClock(),
    });
    expect(report.layers[0]?.artifacts).toEqual([".web-tops/out/hygiene/eslint.json"]);
  });

  it("runs each ts-library tool exactly once, in gate order, and no Astro or CSS tool", async () => {
    const item = setup({ "package.json": PACKAGE });
    const fake = fakeExec(item.project.dir);
    const result = await runHygiene(item, fake.exec);
    expect(sequence(fake)).toEqual([
      "bun install",
      "tsc",
      "eslint",
      "prettier",
      "depcruise",
      "bun audit",
      "bun pm",
      "publint",
      "attw",
    ]);
    expect(result.verdict).toBe("pass");
    expect(skipped(result)).toEqual(["step:astro_check", "step:stylelint"]);
  });

  it("keeps ESLint's JSON in outDir, lists it as an artifact, and does not run ESLint again", async () => {
    const item = setup({ "package.json": PACKAGE });
    const fake = fakeExec(item.project.dir);
    const result = await runHygiene(item, fake.exec);
    const path = join(item.outDir, "hygiene", "eslint.json");
    expect(result.artifacts["eslint-json"]).toBe(path);
    expect(readFileSync(path, "utf8").trim()).not.toBe("");
    expect(fake.count("eslint")).toBe(1);
    expect(fake.calls.find((call) => call.tool === "eslint")?.args).toEqual([
      "--format",
      "json",
      "--output-file",
      path,
      ".",
    ]);
  });

  it("passes the ESLint config named in web-tops.yaml", async () => {
    const item = setup({ "package.json": PACKAGE });
    const fake = fakeExec(item.project.dir);
    await runHygiene(item, fake.exec, { settings: { eslintConfig: "eslint.config.js" } });
    expect(fake.calls.find((call) => call.tool === "eslint")?.args).toContain("eslint.config.js");
  });

  it("runs publint and attw on the packed tarball; ui-components also runs Stylelint", async () => {
    const item = setup({ "package.json": PACKAGE });
    const fake = fakeExec(item.project.dir);
    await runHygiene(item, fake.exec, { className: "ui-components" });
    expect(sequence(fake)).toContain("stylelint");
    expect(sequence(fake)).not.toContain("astro");
    const tarball = join(item.outDir, "hygiene", "pkg-1.0.0.tgz");
    expect(fake.calls.find((call) => call.tool === "publint")?.args).toEqual(["run", tarball]);
    expect(fake.calls.find((call) => call.tool === "attw")?.args[0]).toBe(tarball);
  });

  it("a Vite web-app skips Astro check with a reason that names the condition, and still runs Stylelint", async () => {
    const item = setup();
    const fake = fakeExec(item.project.dir);
    const result = await runHygiene(item, fake.exec, { className: "web-app" });
    expect(sequence(fake)).not.toContain("astro");
    expect(sequence(fake)).toContain("stylelint");
    expect(result.findings).toContainEqual({
      tool: "webtops",
      rule: "step:astro_check",
      verdict: "skip",
      message: "class web-app maps astro_check only when package.json lists astro",
    });
    expect(result.verdict).toBe("pass");
  });

  it.each(["astro-site", "web-app"] as const)(
    "%s runs Astro check and Stylelint, and no package exports",
    async (className) => {
      const item = setup();
      const fake = fakeExec(item.project.dir);
      const result = await runHygiene(item, fake.exec, { className, dependsOnAstro: true });
      expect(sequence(fake)).toContain("astro");
      const globs = fake.calls.find((call) => call.tool === "stylelint")?.args ?? [];
      expect(globs.includes("**/*.astro")).toBe(className === "astro-site");
      expect(sequence(fake)).not.toContain("publint");
      expect(sequence(fake)).not.toContain("bun pm");
      expect(skipped(result)).toEqual(["step:package_exports"]);
    },
  );

  it("runs each tool as node on the installed package's bin file, and bun as a runtime from PATH", async () => {
    const item = setup({ "package.json": PACKAGE });
    const seen: [string, string | undefined][] = [];
    const fake = fakeExec(item.project.dir);
    const spy: Fake["exec"] = (command, args, options) => {
      seen.push([command, args[0]]);
      return fake.exec(command, args, options);
    };
    await runHygiene(item, spy);
    const bin = (name: string, file: string): string =>
      join(item.project.dir, "node_modules", name, "bin", file);
    expect(seen).toContainEqual(["node", bin("typescript", "tsc.js")]);
    expect(seen).toContainEqual(["node", bin("eslint", "eslint.js")]);
    expect(seen).toContainEqual(["node", bin("@arethetypeswrong/cli", "attw.js")]);
    expect(seen).toContainEqual(["bun", "install"]);
    expect(seen.filter(([command]) => command === "tsc" || command === "eslint")).toEqual([]);
  });

  it("hands every tool the caller's environment unchanged: PATH is not extended", async () => {
    const item = setup({ "package.json": PACKAGE });
    const seen: (string | undefined)[] = [];
    const fake = fakeExec(item.project.dir);
    const spy: Fake["exec"] = (command, args, options) => {
      seen.push(options?.env?.["PATH"]);
      return fake.exec(command, args, options);
    };
    await runHygiene(item, spy, { env: { PATH: "/usr/bin" } });
    expect(new Set(seen)).toEqual(new Set(["/usr/bin"]));
  });

  it("maps real tool output to findings: tsc errors, ESLint messages, Prettier files, a dependency cycle", async () => {
    const item = setup({ "package.json": PACKAGE });
    const eslintJson = JSON.stringify([
      {
        filePath: join(item.project.dir, "src", "a.ts"),
        messages: [
          {
            ruleId: "@typescript-eslint/no-explicit-any",
            severity: 2,
            message: "Unexpected any",
            line: 4,
          },
          { ruleId: null, severity: 2, message: "Parsing error", line: 1 },
        ],
      },
    ]);
    const fake = fakeExec(item.project.dir, {
      tsc: () => ({ code: 1, stdout: recorded("tsc-errors.txt"), stderr: "" }),
      eslint: (args) => {
        writeFileForTest(args, eslintJson);
        return { code: 1, stdout: "", stderr: "" };
      },
      prettier: () => ({ code: 1, stdout: "", stderr: recorded("prettier-check.txt") }),
      depcruise: () => ({ code: 1, stdout: recorded("depcruise-circular.json"), stderr: "" }),
    });
    const result = await runHygiene(item, fake.exec);
    expect(result.verdict).toBe("fail");
    const byRule = new Map(result.findings.toReversed().map((finding) => [finding.rule, finding]));
    expect(byRule.get("TS2322")).toMatchObject({ file: "src/z.ts", line: 1, verdict: "fail" });
    expect(byRule.get("@typescript-eslint/no-explicit-any")).toMatchObject({
      file: "src/a.ts",
      line: 4,
    });
    expect(byRule.get("eslint-fatal")?.message).toBe("Parsing error");
    expect(byRule.get("format")).toMatchObject({ file: ".dependency-cruiser.cjs" });
    expect(result.findings.filter((finding) => finding.rule === "format")).toHaveLength(8);
    expect(byRule.get("no-circular")).toMatchObject({
      message: "src/a.ts -> src/b.ts",
      file: "src/a.ts",
    });
    expect(byRule.get("pass")).toBeUndefined();
  });

  it("maps audit advisories at or above fail_on, and none below it", async () => {
    const item = setup({ "package.json": PACKAGE });
    const vulnerable = {
      "bun audit": () => ({ code: 1, stdout: recorded("audit-vulnerable.json"), stderr: "" }),
    };
    const high = await runHygiene(item, fakeExec(item.project.dir, vulnerable).exec);
    const advisories = high.findings.filter((finding) => finding.rule.startsWith("GHSA-"));
    expect(advisories.length).toBeGreaterThanOrEqual(3);
    expect(advisories[0]?.message).toContain("lodash:");
    expect(high.verdict).toBe("fail");
    const critical = await runHygiene(item, fakeExec(item.project.dir, vulnerable).exec, {
      settings: { auditFailOn: "critical" },
    });
    expect(critical.findings.filter((finding) => finding.rule.startsWith("GHSA-"))).toEqual([]);
    expect(critical.verdict).toBe("pass");
  });

  it("stops the later steps as not-run when the frozen install fails", async () => {
    const item = setup({ "package.json": PACKAGE });
    const fake = fakeExec(item.project.dir, {
      "bun install": () => ({
        code: 1,
        stdout: "",
        stderr: "lockfile had changes, but lockfile is frozen",
      }),
    });
    const result = await runHygiene(item, fake.exec);
    expect(sequence(fake)).toEqual(["bun install"]);
    expect(result.findings[0]).toMatchObject({ rule: "install-failed", verdict: "fail" });
    expect(
      result.findings
        .filter((finding) => finding.verdict === "not-run")
        .map((finding) => finding.message),
    ).toEqual(Array(6).fill("stopped: install failed"));
    expect(result.verdict).toBe("fail");
  });
});

function writeFileForTest(args: readonly string[], text: string): void {
  const path = args[args.indexOf("--output-file") + 1] ?? "";
  writeFileSync(path, text);
}
