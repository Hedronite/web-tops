import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec } from "../gate/types.ts";
import { cleanTemp, put, tempDir } from "../laws/probe/testkit.ts";
import { snapshotOf } from "./snapshot.ts";
import type { Snapshot } from "./types.ts";

afterAll(cleanTemp);

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: unknown;
}

function recorder(calls: Call[]): Exec {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return Promise.resolve({ code: 0, stdout: "src/a.ts\0", stderr: "" });
  };
}

const messageOf = (part: Snapshot["settings"] | Snapshot["laws"]): string =>
  part.state === "error" ? part.message : "";

describe("the tracked files of a checkout", () => {
  it("are asked of git as ls-files -z, in the checkout, with the environment it was given", async () => {
    const dir = tempDir();
    put(dir, { "eslint.config.js": "export default [];\n" });
    const calls: Call[] = [];
    const runner = { cwd: dir, env: { A: "1" }, exec: recorder(calls), outDir: join(dir, "out") };
    await snapshotOf(runner, []);
    expect(calls.slice(0, 1)).toEqual([
      { command: "git", args: ["ls-files", "-z"], options: { cwd: dir, env: { A: "1" } } },
    ]);
  });
});

async function snapshotWith(files: Record<string, string>): Promise<Snapshot> {
  const dir = tempDir();
  mkdirSync(join(dir, "laws"));
  put(dir, files);
  const exec: Exec = () => Promise.resolve({ code: 0, stdout: "", stderr: "" });
  return snapshotOf({ cwd: dir, env: {}, exec, outDir: join(dir, "out") }, []);
}

describe("a config or law catalog that cannot be read", () => {
  it("names each problem of the config, by its pointer, one after another with a semicolon", async () => {
    const snap = await snapshotWith({
      "web-tops.yaml": 'protocol: "9"\nversion: 1\nclass: nope\n',
    });
    expect(messageOf(snap.settings).split("; ")).toEqual([
      "/package: must have required property 'package'",
      '/protocol: protocol "9" is outside the range this webtops supports (0.3.x)',
      "/version: must be string",
      '/class: must be equal to one of the allowed values: ["ts-library","ui-components","astro-site","web-app","node-service","cli","workspace-root","config-only"]',
    ]);
  });

  it("words a protocol that is not a string, and a pattern that fails elsewhere, as the config does, not as a protocol outside the range", async () => {
    const wrongType = await snapshotWith({
      "web-tops.yaml": 'protocol: 5\nversion: "1"\npackage: fixture\nclass: ts-library\n',
    });
    expect(messageOf(wrongType.settings)).toBe("/protocol: must be string");
    const elsewhere = await snapshotWith({
      "web-tops.yaml":
        'protocol: "0.3.0"\nversion: "1"\npackage: fixture\nclass: ts-library\nenforce: advisory\nexemption: { until: "soon", reason: "r" }\n',
    });
    expect(messageOf(elsewhere.settings)).toBe(
      '/exemption/until: must match pattern "^\\d{4}-\\d{2}-\\d{2}$"',
    );
  });

  it("names each problem of the catalog, by its file, one after another with a semicolon", async () => {
    const snap = await snapshotWith({
      "laws/W-01.yaml": "id: W-01\n",
      "laws/W-02.yaml": "id: W-02\n",
    });
    const parts = messageOf(snap.laws).split("; ");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => /^W-0[12]\.yaml: \S/u.test(part))).toBe(true);
    expect(parts.some((part) => part.startsWith("W-01.yaml"))).toBe(true);
    expect(parts.some((part) => part.startsWith("W-02.yaml"))).toBe(true);
  });
});
