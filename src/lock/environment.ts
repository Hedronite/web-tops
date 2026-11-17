import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { field } from "./config.ts";
import { installedVersion } from "./installed.ts";

export type Env = Readonly<Record<string, string | undefined>>;
export type ChromiumState = "present" | "missing" | "not-installed";

/** The version a program prints for `--version`, found on the PATH in `env`; undefined when it is absent or prints none. */
export function hostVersion(command: string, env: Env): string | undefined {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", env: { ...env } });
  if (result.error !== undefined || result.status !== 0) return undefined;
  return /\d+(?:\.\d+)+/.exec(result.stdout)?.[0];
}

/** Where Playwright keeps its downloads when `PLAYWRIGHT_BROWSERS_PATH` says nothing. */
function cacheDir(env: Env, platform: string, home: string): string {
  if (platform === "darwin") return join(home, "Library", "Caches", "ms-playwright");
  if (platform === "win32") {
    return join(env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"), "ms-playwright");
  }
  return join(home, ".cache", "ms-playwright");
}

function browsersDir(cwd: string, env: Env, platform: string, home: string): string {
  const set = env["PLAYWRIGHT_BROWSERS_PATH"];
  if (set === "0") return join(cwd, "node_modules", "playwright-core", ".local-browsers");
  if (set !== undefined && set !== "") return set;
  return cacheDir(env, platform, home);
}

function chromiumEntry(doc: unknown): unknown {
  const browsers = field(doc, "browsers");
  return Array.isArray(browsers)
    ? browsers.find((entry: unknown) => field(entry, "name") === "chromium")
    : undefined;
}

function chromiumRevision(cwd: string): string | undefined {
  try {
    const file = join(cwd, "node_modules", "playwright-core", "browsers.json");
    const revision = field(chromiumEntry(JSON.parse(readFileSync(file, "utf8"))), "revision");
    return typeof revision === "string" ? revision : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the chromium build the installed Playwright expects is on disk. */
export function chromiumState(
  cwd: string,
  env: Env,
  platform: string,
  home: string,
): ChromiumState {
  if (installedVersion(cwd, "@playwright/test") === undefined) return "not-installed";
  const revision = chromiumRevision(cwd);
  if (revision === undefined) return "missing";
  const dir = browsersDir(cwd, env, platform, home);
  const found = [`chromium-${revision}`, `chromium_headless_shell-${revision}`].some((name) =>
    existsSync(join(dir, name)),
  );
  return found ? "present" : "missing";
}
