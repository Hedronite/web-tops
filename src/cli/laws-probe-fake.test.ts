import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { realExec } from "../gate/exec.ts";
import type { Exec, ExecResult } from "../gate/types.ts";
import { catalogLaws } from "../laws/probe/catalog.ts";
import { defaults } from "./laws-probe.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import type { ProbeLaw } from "../laws/probe/types.ts";
import { cli, KIT } from "./test-support-probe.ts";

afterAll(cleanTemp);

/** The probe's CLI over a fake ESLint and tsc: fast, in this process, so the command's own code is run and judged here. */

const LAW: ProbeLaw = { id: "W-99", proofs: ["no-thing"] };
const laws = (): readonly ProbeLaw[] => [LAW];

/** A project with ESLint and tsc stubs in node_modules, so `resolveTool` finds them and the fake `exec` stands in for node. */
function project(): string {
  const dir = tempDir();
  const stub = (pkg: string, command: string, bin: string): Record<string, string> => ({
    [`node_modules/${pkg}/package.json`]: JSON.stringify({ name: pkg, bin: { [command]: bin } }),
    [`node_modules/${pkg}/${bin}`]: "",
  });
  put(dir, {
    ...stub("eslint", "eslint", "bin/eslint.js"),
    ...stub("typescript", "tsc", "bin/tsc"),
  });
  return dir;
}

function twins(): string {
  const dir = tempDir();
  put(dir, {
    "W-99/bad/a.ts": "export const a = 1; // expect: no-thing\n",
    "W-99/clean/a.ts": "export const a = 1;\n",
  });
  return dir;
}

const OK: ExecResult = { code: 0, stdout: "", stderr: "" };

/** Fake tools: ESLint writes the findings it is given to its `--output-file`; tsc says nothing. */
function fake(cwd: string, findings: readonly string[], calls: (readonly string[])[] = []): Exec {
  const real = join(realpathSync(cwd), ".web-tops", "out", "laws-probe", "W-99", "bad", "a.ts");
  const messages = findings.map((ruleId) => ({ ruleId, line: 1, message: "m" }));
  return (_command, args) => {
    calls.push(args);
    const at = args.indexOf("--output-file");
    if (at !== -1) {
      writeFileSync(args[at + 1] ?? "", JSON.stringify([{ filePath: real, messages }]));
    }
    return Promise.resolve(OK);
  };
}

const flags = (fixtures: string, ...more: string[]): string[] => [
  "--fixtures",
  fixtures,
  "--law",
  "W-99",
  ...more,
];

describe("G3b the probe's command over fake tools: its text, its JSON and its exit code", () => {
  it("a reader that fires on the bad twin passes: exit 0, a line for the law, and how many pass", async () => {
    const cwd = project();
    const result = await cli(flags(twins()), cwd, { exec: fake(cwd, ["plugin/no-thing"]), laws });
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("W-99  pass\n");
    expect(result.out.endsWith("1 of 1 laws probed pass\n")).toBe(true);
  });

  it("--json prints the report as JSON, with the same exit code", async () => {
    const cwd = project();
    const result = await cli(flags(twins(), "--json"), cwd, {
      exec: fake(cwd, ["plugin/no-thing"]),
      laws,
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      laws: [{ id: "W-99", verdict: "pass", failures: [], unrelated: [] }],
    });
    expect(result.out.endsWith("}\n")).toBe(true);
  });

  it("a silent reader fails the law: exit 1, and the line says which marker stayed quiet", async () => {
    const cwd = project();
    const result = await cli(flags(twins()), cwd, { exec: fake(cwd, []), laws });
    expect(result.code).toBe(1);
    expect(result.out).toContain("W-99  fail\n");
    expect(result.out).toContain(
      "W-99/bad/a.ts:1 stayed quiet: no-thing did not fire on its bad twin",
    );
  });

  it("a missing tool is exit 3 and the message names it, before anything is judged", async () => {
    const result = await cli(flags(twins()), tempDir(), { exec: fake(tempDir(), []), laws });
    expect(result.code).toBe(3);
    expect(result.err).toBe(
      "webtops laws probe: eslint did not run: tool-missing. eslint is not installed in node_modules\n",
    );
    expect(result.out).toBe("");
  });
});

const two = (): readonly ProbeLaw[] => [
  { id: "W-99", proofs: ["no-thing"], classes: ["ts-library"] },
  { id: "W-98", proofs: ["no-thing"], classes: ["web-app"] },
];

function twinsOf(...ids: string[]): string {
  const dir = tempDir();
  for (const id of ids) {
    put(dir, {
      [`${id}/bad/a.ts`]: "export const a = 1; // expect: no-thing\n",
      [`${id}/clean/a.ts`]: "export const a = 1;\n",
    });
  }
  return dir;
}

/** ESLint reports the rule on the bad twin of each given law. */
function fakeFor(cwd: string, ids: readonly string[], calls: (readonly string[])[] = []): Exec {
  const dir = join(realpathSync(cwd), ".web-tops", "out", "laws-probe");
  const files = ids.map((id) => ({
    filePath: join(dir, id, "bad", "a.ts"),
    messages: [{ ruleId: "plugin/no-thing", line: 1, message: "m" }],
  }));
  return (_command, args) => {
    calls.push(args);
    const at = args.indexOf("--output-file");
    if (at !== -1) {
      writeFileSync(args[at + 1] ?? "", JSON.stringify(files));
    }
    return Promise.resolve(OK);
  };
}

describe("G3b which laws the command probes, and with what", () => {
  it("with no flag and no web-tops.yaml it probes the laws a ts-library maps, and no other", async () => {
    const cwd = project();
    const result = await cli(["--fixtures", twinsOf("W-99", "W-98")], cwd, {
      exec: fakeFor(cwd, ["W-99", "W-98"]),
      laws: two,
    });
    expect(result.err).toBe("");
    expect(result.out).toContain("W-99  pass\n");
    expect(result.out).not.toContain("W-98");
    expect(result.out.endsWith("1 of 1 laws probed pass\n")).toBe(true);
  });

  it("the class is the one web-tops.yaml names, and --class beats it", async () => {
    const cwd = project();
    put(cwd, { "web-tops.yaml": "class: web-app\n" });
    const fixtures = twinsOf("W-99", "W-98");
    const named = await cli(["--fixtures", fixtures], cwd, {
      exec: fakeFor(cwd, ["W-98"]),
      laws: two,
    });
    expect(named.out).toContain("W-98  pass\n");
    expect(named.out).not.toContain("W-99");
    const flagged = await cli(["--fixtures", fixtures, "--class", "ts-library"], cwd, {
      exec: fakeFor(cwd, ["W-99"]),
      laws: two,
    });
    expect(flagged.out).toContain("W-99  pass\n");
    expect(flagged.out).not.toContain("W-98");
  });

  it("without --law every law of the class is probed, with it exactly that law whatever the class", async () => {
    const cwd = project();
    const three = (): readonly ProbeLaw[] => [
      ...two(),
      { id: "W-97", proofs: ["no-thing"], classes: ["ts-library"] },
    ];
    const fixtures = twinsOf("W-99", "W-98", "W-97");
    const all = await cli(["--fixtures", fixtures], cwd, {
      exec: fakeFor(cwd, ["W-99", "W-97"]),
      laws: three,
    });
    expect(all.out.endsWith("2 of 2 laws probed pass\n")).toBe(true);
    const one = await cli(["--fixtures", fixtures, "--law", "W-98"], cwd, {
      exec: fakeFor(cwd, ["W-98"]),
      laws: three,
    });
    expect(one.out.endsWith("1 of 1 laws probed pass\n")).toBe(true);
    expect(one.out).toContain("W-98  pass\n");
  });

  it("takes the ESLint config web-tops.yaml names, resolved from the project, and none otherwise", async () => {
    const cwd = project();
    put(cwd, { "web-tops.yaml": "gates:\n  hygiene:\n    eslint: { config: named.config.js }\n" });
    const calls: (readonly string[])[] = [];
    await cli(flags(twins()), cwd, { exec: fake(cwd, ["plugin/no-thing"], calls), laws });
    const args = calls[0] ?? [];
    expect(args[args.indexOf("--config") + 1]).toBe(join(cwd, "named.config.js"));
    const bare = project();
    const barecalls: (readonly string[])[] = [];
    await cli(flags(twins()), bare, { exec: fake(bare, ["plugin/no-thing"], barecalls), laws });
    expect(barecalls[0]).not.toContain("--config");
  });

  it("proves the flags of the tsconfig named, or tsconfig.json of the project when none is", async () => {
    const cwd = project();
    await cli(flags(twins()), cwd, { exec: fake(cwd, ["plugin/no-thing"]), laws });
    const scratch = join(cwd, ".web-tops", "out", "laws-probe", "tsconfig.json");
    expect(readFileSync(scratch, "utf8")).toContain(
      `"extends": ${JSON.stringify(join(cwd, "tsconfig.json"))}`,
    );
    await cli(flags(twins(), "--tsconfig", "other.json"), cwd, {
      exec: fake(cwd, ["plugin/no-thing"]),
      laws,
    });
    expect(readFileSync(scratch, "utf8")).toContain(
      `"extends": ${JSON.stringify(join(cwd, "other.json"))}`,
    );
  });

  it("a usage problem prints the usage once, with no blank line after it", async () => {
    const result = await cli(["--wat"], tempDir());
    expect(result.code).toBe(2);
    expect(result.err.endsWith("[--json]\n")).toBe(true);
    expect(result.err.endsWith("\n\n")).toBe(false);
    expect(result.err).toContain("Unknown option '--wat'");
  });

  it("by default it runs the gate's own exec, the catalog's laws, and the twins the kit ships", () => {
    const made = defaults();
    expect(made.exec).toBe(realExec);
    expect(made.laws).toBe(catalogLaws);
    expect(made.fixtures).toBe(join(KIT, "fixtures", "laws"));
  });
});
