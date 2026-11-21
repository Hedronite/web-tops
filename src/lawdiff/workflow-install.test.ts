import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { cleanTemp, tempDir } from "../laws/probe/testkit.ts";

afterAll(cleanTemp);

const WORKFLOW = resolve(import.meta.dirname, "../../.github/workflows/law-diff.yml");
const STEP = "install the examples' own packages";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const document = (): unknown => parse(readFileSync(WORKFLOW, "utf8"));

/** The run script of the step that installs the examples' packages. */
function script(): string {
  const list = field(field(field(document(), "jobs"), "law-diff"), "steps");
  const steps = Array.isArray(list) ? list : [];
  return String(
    field(
      steps.find((one) => field(one, "name") === STEP),
      "run",
    ),
  );
}

/** The step run by bash beside trees that hold the manifests named, with a `bun` that says where it was asked to run. */
function installs(manifests: readonly string[]): {
  status: number | null;
  out: string;
  root: string;
} {
  const root = realpathSync(tempDir());
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "bun"), '#!/bin/sh\necho "bun $* in $(pwd)"\n');
  chmodSync(join(bin, "bun"), 0o755);
  for (const tree of ["trusted", "head"]) mkdirSync(join(root, tree, "src"), { recursive: true });
  for (const manifest of manifests) {
    mkdirSync(join(root, manifest, ".."), { recursive: true });
    writeFileSync(join(root, manifest), "{}");
  }
  const done = spawnSync("bash", ["-c", script()], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: `${bin}:${String(process.env["PATH"])}` },
  });
  return { status: done.status, out: done.stdout, root };
}

describe("the step that installs the examples' own packages", () => {
  it("does nothing, and succeeds, in trees that have no examples", () => {
    expect(installs([])).toMatchObject({ status: 0, out: "" });
  });

  it("installs each example that has a manifest, frozen, in the trusted tree and in the head tree, and skips a folder with none", () => {
    const done = installs([
      "head/examples/service/package.json",
      "head/examples/other/package.json",
      "head/examples/notes/README.md",
      "trusted/examples/service/package.json",
    ]);
    const lines = done.out.trimEnd().split("\n");
    expect(done.status).toBe(0);
    expect(lines).toEqual([
      `bun install --frozen-lockfile in ${done.root}/trusted/examples/service`,
      `bun install --frozen-lockfile in ${done.root}/head/examples/other`,
      `bun install --frozen-lockfile in ${done.root}/head/examples/service`,
    ]);
  });

  it("stops at an install that fails", () => {
    const root = realpathSync(tempDir());
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "bun"), "#!/bin/sh\nexit 7\n");
    chmodSync(join(bin, "bun"), 0o755);
    mkdirSync(join(root, "head/examples/service"), { recursive: true });
    writeFileSync(join(root, "head/examples/service/package.json"), "{}");
    const done = spawnSync("bash", ["-e", "-c", script()], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: `${bin}:${String(process.env["PATH"])}` },
    });
    expect(done.status).toBe(7);
  });
});
