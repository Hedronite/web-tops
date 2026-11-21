import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";

afterAll(cleanTemp);

const WORKFLOW = resolve(import.meta.dirname, "../../.github/workflows/law-diff.yml");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const triggers = (): Record<string, unknown> => {
  const found = field(document(), "on");
  return isRecord(found) ? found : {};
};

const document = (): unknown => parse(readFileSync(WORKFLOW, "utf8"));

function steps(): unknown[] {
  const list = field(field(field(document(), "jobs"), "law-diff"), "steps");
  return Array.isArray(list) ? list : [];
}

describe("the law-diff workflow", () => {
  it("runs on pull_request label events with read-only permissions, and never on pull_request_target", () => {
    expect(field(field(document(), "on"), "pull_request")).toEqual({
      types: ["opened", "synchronize", "reopened", "labeled", "unlabeled"],
    });
    expect(Object.keys(triggers())).toEqual(["pull_request"]);
    expect(field(document(), "permissions")).toEqual({ contents: "read", "pull-requests": "read" });
    expect(
      readFileSync(WORKFLOW, "utf8")
        .split("\n")
        .filter((line) => !line.startsWith("#"))
        .join("\n"),
    ).not.toContain("pull_request_target");
  });

  it("pins every action to a commit and checks out the whole history of the head and the base", () => {
    const uses = steps().flatMap((step) => {
      const name = field(step, "uses");
      return typeof name === "string" ? [name] : [];
    });
    expect(uses).toHaveLength(4);
    for (const name of uses) expect(name).toMatch(/@[0-9a-f]{40}$/u);
    const checkouts = steps().filter((step) =>
      String(field(step, "uses")).startsWith("actions/checkout"),
    );
    expect(checkouts.map((step) => field(field(step, "with"), "path"))).toEqual([
      "head",
      "trusted",
    ]);
    expect(field(field(checkouts[0], "with"), "fetch-depth")).toBe(0);
  });
});

/** The command step, run by bash with a `bun` that prints what it is asked to run, beside a base that has or lacks law-diff. */
function commandRun(baseHasLawDiff: boolean): { status: number | null; out: string } {
  const root = tempDir();
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "bun"), '#!/bin/sh\necho "bun $*"\n');
  chmodSync(join(bin, "bun"), 0o755);
  mkdirSync(join(root, "head"));
  mkdirSync(join(root, "trusted/src/cli"), { recursive: true });
  if (baseHasLawDiff) mkdirSync(join(root, "trusted/src/lawdiff"));
  const step = steps().find((one) => field(one, "name") === "law-diff");
  const done = spawnSync("bash", ["-c", String(field(step, "run"))], {
    cwd: join(root, "head"),
    encoding: "utf8",
    env: { PATH: `${bin}:${String(process.env["PATH"])}`, BASE_REF: "main", HEAD_SHA: "abc123" },
  });
  return { status: done.status, out: done.stdout };
}

describe("the law-diff step", () => {
  it("runs the base's own command over the head when the base has law-diff", () => {
    expect(commandRun(true)).toEqual({
      status: 0,
      out: "bun ../trusted/src/cli/main.ts law-diff origin/main abc123\n",
    });
  });

  it("runs the head's own command and says the base has no law-diff when it has none, and never skips", () => {
    expect(commandRun(false)).toEqual({
      status: 0,
      out: "bootstrap: the base has no law-diff\nbun ./src/cli/main.ts law-diff origin/main abc123\n",
    });
  });
});
