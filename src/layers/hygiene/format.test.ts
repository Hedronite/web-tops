import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realExec } from "../../gate/exec.ts";
import { off } from "../../gate/testkit.ts";
import { HYGIENE_STEPS, type HygieneStep } from "../../gate/types.ts";
import { fakeExec, prepare, runHygiene, type Prepared } from "./testkit.ts";

/** R41: the format step never judges the gate's own output, whatever the project's ignore files say. */

const prepared: Prepared[] = [];

afterEach(() => {
  for (const item of prepared.splice(0)) {
    item.project.cleanup();
  }
});

function setup(files: Record<string, string>, real = false): Prepared {
  const item = prepare(files, { real });
  prepared.push(item);
  return item;
}

function only(keep: HygieneStep): Partial<Record<HygieneStep, ReturnType<typeof off>>> {
  return Object.fromEntries(
    HYGIENE_STEPS.filter((step) => step !== keep).map((step) => [step, off("not under test")]),
  );
}

function plant(item: Prepared, path: string, text: string): void {
  mkdirSync(dirname(join(item.project.dir, path)), { recursive: true });
  writeFileSync(join(item.project.dir, path), text);
}

/** What ESLint leaves for the laws layer: JSON that Prettier would reformat. */
const GATE_OUTPUT = ".web-tops/out/hygiene/eslint.json";
const UNFORMATTED = '{"results":   []}';

describe("G3d format: Prettier does not judge .web-tops (real run)", () => {
  it.each([
    ["no ignore file at all", {}],
    ["a .gitignore that does not list .web-tops", { ".gitignore": "node_modules\n" }],
    ["a .prettierignore that does not list it", { ".prettierignore": "dist\n" }],
  ])(
    "passes with %s, though the gate's JSON is not Prettier-formatted",
    async (_label, ignores) => {
      const item = setup({ "src/a.ts": "export const a = 1;\n", ...ignores }, true);
      plant(item, GATE_OUTPUT, UNFORMATTED);
      const result = await runHygiene(item, realExec, {
        env: { PATH: process.env["PATH"] },
        steps: only("format"),
      });
      expect(result.findings.filter((finding) => finding.verdict === "Refuse")).toEqual([]);
      expect(result.verdict).toBe("pass");
    },
  );

  it("still fails a project file that is not formatted, and names that file and not the gate's", async () => {
    const item = setup(
      { "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const   b = 1\n" },
      true,
    );
    plant(item, GATE_OUTPUT, UNFORMATTED);
    const result = await runHygiene(item, realExec, {
      env: { PATH: process.env["PATH"] },
      steps: only("format"),
    });
    const files = result.findings
      .filter((finding) => finding.rule === "format")
      .map((finding) => finding.file);
    expect(files).toEqual(["src/b.ts"]);
    expect(result.verdict).toBe("Refuse");
  });
});

describe("G3d format: what the layer hands each formatter", () => {
  it("gives Prettier the project and a negated pattern for .web-tops", async () => {
    const item = setup({});
    const fake = fakeExec(item.project.dir);
    await runHygiene(item, fake.exec, { steps: only("format") });
    expect(fake.calls.find((call) => call.tool === "prettier")?.args).toEqual([
      "--check",
      ".",
      "!.web-tops/**",
    ]);
  });

  it("gives Biome every top-level entry but .web-tops, since it has no exclude flag", async () => {
    const item = setup(
      { "biome.json": "{}", "src/a.ts": "export {};\n", "README.md": "x\n" },
      false,
    );
    plant(item, GATE_OUTPUT, UNFORMATTED);
    const fake = fakeExec(item.project.dir);
    await runHygiene(item, fake.exec, {
      steps: only("format"),
      settings: { formatTool: "biome" },
    });
    const args = fake.calls.find((call) => call.tool === "biome")?.args ?? [];
    const entries = readdirSync(item.project.dir).filter((name) => name !== ".web-tops");
    expect(args[0]).toBe("format");
    expect(args.slice(1).sort()).toEqual(entries.sort());
    expect(args).not.toContain(".web-tops");
    expect(args).toContain("src");
  });

  it("with nothing but .web-tops to look at, Biome has nothing to judge and is not run", async () => {
    const item = setup({}, false);
    for (const name of readdirSync(item.project.dir)) {
      if (name !== ".web-tops") {
        // keep only the gate's own directory
        (await import("node:fs")).rmSync(join(item.project.dir, name), { recursive: true });
      }
    }
    const fake = fakeExec(item.project.dir);
    const result = await runHygiene(item, fake.exec, {
      steps: only("format"),
      settings: { formatTool: "biome" },
    });
    expect(fake.count("biome")).toBe(0);
    expect(result.verdict).toBe("pass");
  });
});
