import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runInitCli } from "./init.ts";
import { madeDirs, snapshot, tempDir } from "../init/test-support.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

async function cli(
  argv: readonly string[],
  cwd: string,
): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await runInitCli(argv, {
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

describe("webtops init (command)", () => {
  it("writes the drop-in set into the working directory and lists it", async () => {
    const dir = tempDir();
    const { code, out, err } = await cli(["--class", "astro-site"], dir);
    expect(code).toBe(0);
    expect(err).toBe("");
    for (const path of snapshot(dir).keys()) expect(out).toContain(path);
    expect(out).not.toContain("stryker");
    expect(out).not.toContain("deferred");
  });

  it("accepts --class=<name>", async () => {
    const dir = tempDir();
    expect((await cli(["--class=ts-library"], dir)).code).toBe(0);
    expect(snapshot(dir).has("web-tops.yaml")).toBe(true);
  });

  it("prints the install line for the class's tools, and writes no package.json", async () => {
    const dir = tempDir();
    const { out } = await cli(["--class", "ts-library"], dir);
    expect(out).toMatch(/bun add -d .*typescript@6\.0\.3/);
    expect(snapshot(dir).has("package.json")).toBe(false);
  });

  it("exits 2 with a usage line when --class is missing, and writes nothing", async () => {
    const dir = tempDir();
    const { code, out, err } = await cli([], dir);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("usage: webtops init --class");
    expect(snapshot(dir).size).toBe(0);
  });

  it("exits 2 when --class has no value", async () => {
    const dir = tempDir();
    expect((await cli(["--class"], dir)).code).toBe(2);
  });

  it("exits 2 for an unknown class and names the launch classes", async () => {
    const { code, err } = await cli(["--class", "cli"], tempDir());
    expect(code).toBe(2);
    for (const name of ["ts-library", "ui-components", "astro-site", "web-app", "node-service"]) {
      expect(err).toContain(name);
    }
  });

  it("exits 2 for an unknown flag", async () => {
    const dir = tempDir();
    const { code, err } = await cli(["--class", "ts-library", "--wat"], dir);
    expect(code).toBe(2);
    expect(err).toContain("--wat");
    expect(snapshot(dir).size).toBe(0);
  });

  it("exits 4 on a second run and names the files it would overwrite on stderr", async () => {
    const dir = tempDir();
    await cli(["--class", "ts-library"], dir);
    const { code, err } = await cli(["--class", "ts-library"], dir);
    expect(code).toBe(4);
    expect(err).toContain("web-tops.yaml");
    expect(err).toContain("--force");
  });

  it("--force overwrites on a second run", async () => {
    const dir = tempDir();
    await cli(["--class", "ts-library"], dir);
    expect((await cli(["--class", "ts-library", "--force"], dir)).code).toBe(0);
  });

  it("exits 3 when the working directory cannot be written", async () => {
    const { code, err } = await cli(["--class", "ts-library"], join(tempDir(), "gone"));
    expect(code).toBe(3);
    expect(err).not.toBe("");
  });
});
