import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BUILD_OUTPUT_STUB, LAWS_STUB } from "../gate/stubs.ts";
import { writeKitConfig } from "../layers/tests/index.ts";
import type { Io } from "./io.ts";
import { main, run } from "./main.ts";

// The entry point called in-process. The `import.meta.main` guard that hands it `process.argv` is
// the one line such a call cannot reach; the spawn tests in main.test.ts cover it.

const USAGE =
  "usage: webtops <command>\ncommands: baseline, check, doctor, gate, init, lock, report, survivors, version, laws\n";

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

  it("require nothing unless they say so: laws waits for hygiene", () => {
    expect(BUILD_OUTPUT_STUB.requires).toEqual([]);
    expect(LAWS_STUB.requires).toEqual(["hygiene"]);
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

  function project(): { root: string; out: string } {
    const root = mkdtempSync(join(tmpdir(), "wt-kit-config-"));
    roots.push(root);
    const out = join(root, "out");
    mkdirSync(out);
    return { root, out };
  }

  it.each(names)("%s", (name) => {
    const { root, out } = project();
    writeFileSync(join(root, name), "export default {};\n");
    const written = readFileSync(writeKitConfig(root, out), "utf8");
    expect(written).toContain(`const project = ${JSON.stringify(join(root, name))};`);
  });

  it("writes a plain empty config when the project has none", () => {
    const { root, out } = project();
    expect(readFileSync(writeKitConfig(root, out), "utf8")).toBe("export default {};\n");
  });

  it("writes its lines apart, and names bare vite when no vitest is installed beside the project", () => {
    const { root, out } = project();
    writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
    const written = readFileSync(writeKitConfig(root, out), "utf8");
    expect(written).toContain('import { writeFileSync } from "node:fs";\nimport { relative');
    expect(written).toContain('const viteUrl = "vite";\n');
  });

  it("names the vite that sits inside the installed vitest, as a file URL", () => {
    const { root, out } = project();
    writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
    const vitest = join(root, "node_modules", "vitest");
    const vite = join(vitest, "node_modules", "vite");
    mkdirSync(vite, { recursive: true });
    writeFileSync(join(vitest, "package.json"), '{"name":"vitest"}');
    writeFileSync(join(vite, "package.json"), '{"name":"vite","main":"index.js"}');
    writeFileSync(join(vite, "index.js"), "module.exports = {};\n");
    const url = pathToFileURL(
      join(realpathSync(root), "node_modules/vitest/node_modules/vite/index.js"),
    ).href;
    expect(readFileSync(writeKitConfig(root, out), "utf8")).toContain(
      `const viteUrl = ${JSON.stringify(url)};`,
    );
  });
});
