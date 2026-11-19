import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUILD_OUTPUT_STUB, LAWS_STUB } from "../gate/stubs.ts";
import { writeKitConfig } from "../layers/tests/index.ts";
import type { Io } from "./io.ts";
import { main, run } from "./main.ts";

// The entry point called in-process. The `import.meta.main` guard that hands it `process.argv` is
// the one line such a call cannot reach; the spawn tests in main.test.ts cover it.

const USAGE =
  "usage: webtops <command>\ncommands: baseline, check, doctor, gate, init, lock, report, survivors, version\n";

function capture(): { io: Io; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: process.cwd(),
    env: {},
  };
  return { io, out: () => out, err: () => err };
}

describe("main drops the runtime and script names and runs the command", () => {
  it("exits 2 and prints exactly the usage line when no command follows the two names", async () => {
    const { io, out, err } = capture();
    expect(await main(["bun", "src/cli/main.ts"], io)).toBe(2);
    expect(out()).toBe("");
    expect(err()).toBe(USAGE);
  });

  it("names the first argument after the two names as an unknown command", async () => {
    const { io, out, err } = capture();
    expect(await main(["bun", "src/cli/main.ts", "frobnicate", "version"], io)).toBe(2);
    expect(out()).toBe("");
    expect(err()).toBe(`webtops: unknown command "frobnicate"\n${USAGE}`);
  });

  it("gives what run gives for the arguments after the two names", async () => {
    const viaMain = capture();
    const viaRun = capture();
    const argv = ["version", "--frobnicate"];
    expect(await main(["bun", "main.ts", ...argv], viaMain.io)).toBe(await run(argv, viaRun.io));
    expect(viaMain.err()).toBe(viaRun.err());
    expect(viaMain.out()).toBe(viaRun.out());
  });
});

describe("run with no command", () => {
  it("prints only the usage line, with no command name in it", () => {
    const { io, err } = capture();
    expect(run([], io)).toBe(2);
    expect(err()).toBe(USAGE);
  });
});

describe("the layers that are not built yet", () => {
  it.each([
    ["build-output", BUILD_OUTPUT_STUB],
    ["laws", LAWS_STUB],
  ])("%s produces and consumes nothing", (id, stub) => {
    expect(stub.id).toBe(id);
    expect(stub.produces).toEqual([]);
    expect(stub.consumes).toEqual([]);
  });
});

describe("the project's Vitest config is found under every name Vitest accepts", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const names = ["vitest.config", "vite.config"].flatMap((base) =>
    ["ts", "mts", "cts", "js", "mjs", "cjs"].map((extension) => `${base}.${extension}`),
  );

  it.each(names)("%s", (name) => {
    const root = mkdtempSync(join(tmpdir(), "wt-kit-config-"));
    roots.push(root);
    const out = join(root, "out");
    mkdirSync(out);
    writeFileSync(join(root, name), "export default {};\n");
    const written = readFileSync(writeKitConfig(root, out), "utf8");
    expect(written).toContain(`const project = ${JSON.stringify(join(root, name))};`);
  });

  it("writes a plain empty config when the project has none", () => {
    const root = mkdtempSync(join(tmpdir(), "wt-kit-config-"));
    roots.push(root);
    const out = join(root, "out");
    mkdirSync(out);
    expect(readFileSync(writeKitConfig(root, out), "utf8")).toBe("export default {};\n");
  });
});
