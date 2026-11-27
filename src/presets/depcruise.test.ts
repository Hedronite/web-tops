import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REAL_TOOL_TIMEOUT } from "../gate/test-support-timeouts.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A package that declares `react` as a peer, with `react` installed, and these files under src. */
function peerPackage(files: Readonly<Record<string, string>>, peer = "react"): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-depcruise-"));
  made.push(dir);
  const all: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "probe",
      type: "module",
      peerDependencies: { [peer]: "*" },
      peerDependenciesMeta: { [peer]: { optional: true } },
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { module: "preserve", moduleResolution: "bundler", noEmit: true },
      include: ["src"],
    }),
    [`node_modules/${peer}/package.json`]: JSON.stringify({ name: peer, main: "index.js" }),
    [`node_modules/${peer}/index.js`]: "module.exports = {};\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  symlinkSync(join(ROOT, "node_modules", "typescript"), join(dir, "node_modules", "typescript"));
  return dir;
}

function cruise(dir: string): { status: number | null; output: string } {
  const bin = join(ROOT, "node_modules", ".bin", "depcruise");
  const config = join(ROOT, "src", "presets", "depcruise.cjs");
  const result = spawnSync(bin, ["--config", config, "src"], { cwd: dir, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const IMPORT = 'import * as peer from "react";\nexport const value = peer;\n';
const NAME = "no-optional-peer-import";

/** Real processes only: no mutant of a mutation run reaches them (R112). */
const insideStryker = process.env["STRYKER_MUTATOR_WORKER"] !== undefined;

describe.skipIf(insideStryker)(
  "W-19: web-tops/depcruise keeps an optional peer to the entries that declare it",
  () => {
    it(
      "flags an import of a peer from a file outside the react entries and the adapters",
      () => {
        const result = cruise(peerPackage({ "src/index.ts": IMPORT }));
        expect(result.status, result.output).toBe(1);
        expect(result.output).toContain(NAME);
        expect(result.output).toContain("src/index.ts");
      },
      REAL_TOOL_TIMEOUT,
    );

    it.each(["src/react/index.ts", "src/react.ts", "src/adapters/three.ts", "src/lib/react/a.tsx"])(
      "lets %s import it",
      (file) => {
        const result = cruise(peerPackage({ [file]: IMPORT }));
        expect(result.output).not.toContain(NAME);
        expect(result.status, result.output).toBe(0);
      },
      REAL_TOOL_TIMEOUT,
    );

    it(
      "flags the R3F and three peers too",
      () => {
        const result = cruise(
          peerPackage(
            { "src/index.ts": 'import * as peer from "three";\nexport const v = peer;\n' },
            "three",
          ),
        );
        expect(result.output).toContain(NAME);
      },
      REAL_TOOL_TIMEOUT,
    );

    it(
      "leaves a package that depends on react directly alone",
      () => {
        const dir = peerPackage({ "src/index.ts": IMPORT });
        writeFileSync(
          join(dir, "package.json"),
          JSON.stringify({ name: "probe", type: "module", dependencies: { react: "*" } }),
        );
        const result = cruise(dir);
        expect(result.output).not.toContain(NAME);
        expect(result.status, result.output).toBe(0);
      },
      REAL_TOOL_TIMEOUT,
    );

    it(
      "leaves another peer alone",
      () => {
        const result = cruise(
          peerPackage(
            { "src/index.ts": 'import * as peer from "left-pad";\nexport const v = peer;\n' },
            "left-pad",
          ),
        );
        expect(result.output).not.toContain(NAME);
        expect(result.status, result.output).toBe(0);
      },
      REAL_TOOL_TIMEOUT,
    );
  },
);
