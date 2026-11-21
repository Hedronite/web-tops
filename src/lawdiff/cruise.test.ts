import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Runner } from "../census/eslint.ts";
import type { Exec } from "../gate/types.ts";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";
import { askCruise, configNames, cruiseOf } from "./cruise.ts";
import type { Cruise } from "./types.ts";

afterAll(cleanTemp);

const must = (value: Cruise | undefined): Cruise => {
  if (value === undefined) throw new Error("not a config");
  return value;
};

const config = {
  forbidden: [
    { name: "no-circular", severity: "error", comment: "why", from: {}, to: { circular: true } },
    { name: "no-orphans", from: { orphan: true }, to: {} },
    { severity: "error", from: { path: "a" }, to: { path: "b" } },
    "not a rule",
    { name: 4 },
  ],
  required: [{ name: "needs-test", severity: "info", module: { path: "x" }, to: {} }],
  allowed: [{ from: {}, to: {} }],
  allowedSeverity: "ignore",
  options: { exclude: { path: ["^dist", 4, "^build"] }, doNotFollow: "node_modules" },
};

const rankOf = (found: Cruise, key: string): [string, number] => {
  const value = found.values.get(key);
  return [String(value?.shown), Number(value?.rank)];
};

describe("the rules of a dependency-cruiser config", () => {
  it("are each named rule's severity, ranked ignore < info < warn < error, with warn for one that names none", () => {
    const found = must(cruiseOf(config));
    expect(rankOf(found, "forbidden: no-circular")).toEqual(["error", 3]);
    expect(rankOf(found, "forbidden: no-orphans")).toEqual(["warn", 2]);
    expect(rankOf(found, "required: needs-test")).toEqual(["info", 1]);
    expect(rankOf(found, "allowedSeverity")).toEqual(["ignore", 0]);
    expect(rankOf(must(cruiseOf({})), "allowedSeverity")).toEqual(["warn", 2]);
    expect(rankOf(must(cruiseOf({ allowedSeverity: 7 })), "allowedSeverity")).toEqual(["warn", 2]);
  });

  it("hold each rule's definition for review, without its name, severity and comment", () => {
    const found = must(cruiseOf(config));
    expect(found.values.get("forbidden: no-circular definition")).toEqual({
      shown: '{"from":{},"to":{"circular":true}}',
      rank: 0,
      review: true,
    });
    expect(rankOf(found, "required: needs-test definition")[0]).toBe(
      '{"module":{"path":"x"},"to":{}}',
    );
    expect([...found.values.keys()]).toEqual([
      "forbidden: no-circular",
      "forbidden: no-circular definition",
      "forbidden: no-orphans",
      "forbidden: no-orphans definition",
      "required: needs-test",
      "required: needs-test definition",
      "allowedSeverity",
    ]);
  });

  it("hold the allowed entries and the rules that name nothing", () => {
    expect(must(cruiseOf(config)).allowed).toEqual([
      '{"from":{},"to":{}}',
      'forbidden: {"severity":"error","from":{"path":"a"},"to":{"path":"b"}}',
      'forbidden: {"name":4}',
    ]);
    expect(must(cruiseOf({ allowed: 4, forbidden: 4, required: 4 })).allowed).toEqual([]);
  });

  it("hold what is left out or not followed: a pattern, a list, or an object with a path", () => {
    expect(must(cruiseOf(config)).excluded).toEqual([
      "exclude: ^dist",
      "exclude: ^build",
      "doNotFollow: node_modules",
    ]);
    const options = { exclude: "^x", doNotFollow: { path: "^y" } };
    expect(must(cruiseOf({ options })).excluded).toEqual(["exclude: ^x", "doNotFollow: ^y"]);
    expect(must(cruiseOf({ options: { exclude: 4, doNotFollow: { path: 4 } } })).excluded).toEqual(
      [],
    );
    expect(must(cruiseOf({ options: 4 })).excluded).toEqual([]);
  });

  it("are nothing when what was read is not a config", () => {
    expect(cruiseOf(undefined)).toBeUndefined();
    expect(cruiseOf([])).toBeUndefined();
    expect(cruiseOf("x")).toBeUndefined();
  });

  it("are looked for in the four files dependency-cruiser looks for", () => {
    expect(configNames()).toEqual([
      ".dependency-cruiser.json",
      ".dependency-cruiser.cjs",
      ".dependency-cruiser.js",
      ".dependency-cruiser.mjs",
    ]);
  });
});

function runner(exec: Exec): Runner {
  return { cwd: "/proj", env: { A: "1" }, exec, outDir: join(tempDir(), "out") };
}

interface Call {
  readonly command: string;
  readonly script: string;
  readonly path: string | undefined;
  readonly marker: string | undefined;
  readonly cwd: string | undefined;
}

const envOf = (options: { env?: Record<string, string | undefined> } | undefined) =>
  options?.env ?? {};

function recorder(calls: Call[]): Exec {
  return (command, args, options) => {
    const env = envOf(options);
    const script = readFileSync(String(args[0]), "utf8");
    calls.push({
      command,
      script,
      path: env["WEBTOPS_LAWDIFF_CONFIG"],
      marker: env["A"],
      cwd: options?.cwd,
    });
    return Promise.resolve({ code: 0, stdout: JSON.stringify(config), stderr: "" });
  };
}

const says =
  (code: number | null, stdout: string, stderr = "", failure?: "tool-timeout"): Exec =>
  () =>
    Promise.resolve(
      failure === undefined ? { code, stdout, stderr } : { code, stdout, stderr, failure },
    );

describe("reading the config through dependency-cruiser", () => {
  it("runs a script under node from the checkout, with the config's path, and reads the JSON it prints", async () => {
    const calls: Call[] = [];
    const read = await askCruise(runner(recorder(calls)), ".dependency-cruiser.cjs");
    expect(read.ok).toBe(true);
    expect(calls).toMatchObject([
      { command: "node", path: "/proj/.dependency-cruiser.cjs", marker: "1", cwd: "/proj" },
    ]);
    expect(calls.every((call) => call.script.includes("config-utl/extract-depcruise-config"))).toBe(
      true,
    );
  });

  it("says why when it cannot be read: an exit, a timeout, or something that is not a config", async () => {
    expect(await askCruise(runner(says(1, "", "a\nb\nc\nd")), "c.cjs")).toEqual({
      ok: false,
      message: "dependency-cruiser's config could not be read (exit 1: b c d)",
    });
    expect(await askCruise(runner(says(null, "", "", "tool-timeout")), "c.cjs")).toEqual({
      ok: false,
      message: "dependency-cruiser's config could not be read (tool-timeout)",
    });
    expect(await askCruise(runner(says(0, "[]")), "c.cjs")).toEqual({
      ok: false,
      message: "dependency-cruiser printed something that is not a config",
    });
    expect((await askCruise(runner(says(0, "nope")), "c.cjs")).ok).toBe(false);
  });
});
