import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseLock } from "../lock/format.ts";
import { TOOL_PINS } from "../lock/pins.ts";
import { runInit } from "./run.ts";
import { madeDirs, put, tempDir } from "./test-support.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

const PLUGIN = "eslint-plugin-astro";
const withAstro = (field: string): string =>
  JSON.stringify({ name: "p", version: "1.0.0", [field]: { astro: "7.4.12" } });

function initInto(className: string, files: Readonly<Record<string, string>>) {
  const dir = tempDir();
  for (const [path, text] of Object.entries(files)) put(dir, path, text);
  const outcome = runInit({ className, dir, force: false });
  expect(outcome.code, outcome.problems.join("\n")).toBe(0);
  const lock = parseLock(readFileSync(join(dir, "web-tops.lock"), "utf8"));
  return { install: outcome.install, locked: lock.ok ? Object.keys(lock.lock) : [] };
}

const times = (install: readonly string[]): number =>
  install.filter((entry) => entry.startsWith(`${PLUGIN}@`)).length;

describe("R105: init lists the Astro parser among web-app's conditional tools", () => {
  it.each(["dependencies", "devDependencies", "peerDependencies"])(
    "web-app with astro in %s installs and locks it once, at its pin",
    (field) => {
      const { install, locked } = initInto("web-app", { "package.json": withAstro(field) });
      expect(install.filter((entry) => entry.startsWith(`${PLUGIN}@`))).toEqual([
        `${PLUGIN}@${Reflect.get(TOOL_PINS, PLUGIN)}`,
      ]);
      expect(locked).toContain(PLUGIN);
    },
  );

  it("web-app without astro installs and locks no Astro tool", () => {
    for (const files of [{}, { "package.json": "{ nope" }]) {
      const { install, locked } = initInto("web-app", files);
      expect(times(install)).toBe(0);
      expect(locked).not.toContain(PLUGIN);
    }
  });

  it.each(["ui-components", "ts-library", "node-service"])(
    "%s lists it never, even with astro in package.json",
    (className) => {
      const { install, locked } = initInto(className, {
        "package.json": withAstro("dependencies"),
      });
      expect(times(install)).toBe(0);
      expect(locked).not.toContain(PLUGIN);
    },
  );

  it("astro-site, which lists it among its tools, installs it once with or without astro", () => {
    for (const files of [{}, { "package.json": withAstro("dependencies") }]) {
      expect(times(initInto("astro-site", files).install)).toBe(1);
    }
  });
});
