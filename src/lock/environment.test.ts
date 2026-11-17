import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { fakeHost, madeDirs, put, tempDir } from "../init/test-support.ts";
import { chromiumState, hostVersion } from "./environment.ts";

afterAll(() => {
  for (const dir of madeDirs()) rmSync(dir, { recursive: true, force: true });
});

describe("hostVersion", () => {
  it.each([
    ["v24.22.3", "24.22.3"],
    ["1.4.4", "1.4.4"],
    ["Bun 1.4.4 (abc)", "1.4.4"],
  ])("reads %j as %s", (printed, version) => {
    expect(hostVersion("tool", fakeHost({ tool: printed }))).toBe(version);
  });

  it("is undefined for a program that is not on the PATH", () => {
    expect(hostVersion("tool", fakeHost({}))).toBeUndefined();
  });

  it("is undefined for a program that prints no version", () => {
    expect(hostVersion("tool", fakeHost({ tool: "hello" }))).toBeUndefined();
  });

  it("looks only on the PATH it is given", () => {
    expect(hostVersion("tool", { PATH: fakeHost({ tool: "9.9.9" })["PATH"] })).toBe("9.9.9");
    expect(hostVersion("definitely-not-a-program", fakeHost({ tool: "9.9.9" }))).toBeUndefined();
  });
});

describe("chromiumState", () => {
  function playwrightProject(revision: string | null): string {
    const dir = tempDir();
    put(dir, "node_modules/@playwright/test/package.json", JSON.stringify({ version: "1.65.1" }));
    if (revision !== null) {
      put(
        dir,
        "node_modules/playwright-core/browsers.json",
        JSON.stringify({ browsers: [{ name: "chromium", revision }] }),
      );
    }
    return dir;
  }

  it("is not-installed without @playwright/test", () => {
    const env = { PLAYWRIGHT_BROWSERS_PATH: tempDir() };
    expect(chromiumState(tempDir(), env, "linux", tempDir())).toBe("not-installed");
  });

  it("is missing when the browsers directory lacks the revision", () => {
    const env = { PLAYWRIGHT_BROWSERS_PATH: tempDir() };
    expect(chromiumState(playwrightProject("1234"), env, "linux", tempDir())).toBe("missing");
  });

  it("is missing when browsers.json is not there to name the revision", () => {
    const env = { PLAYWRIGHT_BROWSERS_PATH: tempDir() };
    expect(chromiumState(playwrightProject(null), env, "linux", tempDir())).toBe("missing");
  });

  it.each(["chromium-1234", "chromium_headless_shell-1234"])(
    "is present when %s exists",
    (name) => {
      const browsers = tempDir();
      put(browsers, `${name}/INSTALLATION_COMPLETE`, "");
      const env = { PLAYWRIGHT_BROWSERS_PATH: browsers };
      expect(chromiumState(playwrightProject("1234"), env, "linux", tempDir())).toBe("present");
    },
  );

  it("looks in the OS cache when the variable is unset", () => {
    const dir = playwrightProject("1234");
    const home = tempDir();
    put(home, ".cache/ms-playwright/chromium-1234/INSTALLATION_COMPLETE", "");
    expect(chromiumState(dir, {}, "linux", home)).toBe("present");
    const mac = tempDir();
    put(mac, "Library/Caches/ms-playwright/chromium-1234/INSTALLATION_COMPLETE", "");
    expect(chromiumState(dir, {}, "darwin", mac)).toBe("present");
  });

  it("looks in LOCALAPPDATA on Windows", () => {
    const dir = playwrightProject("1234");
    const appData = tempDir();
    put(appData, "ms-playwright/chromium-1234/INSTALLATION_COMPLETE", "");
    expect(chromiumState(dir, { LOCALAPPDATA: appData }, "win32", tempDir())).toBe("present");
  });

  it("looks inside node_modules when the variable is 0", () => {
    const dir = playwrightProject("1234");
    put(
      dir,
      "node_modules/playwright-core/.local-browsers/chromium-1234/INSTALLATION_COMPLETE",
      "",
    );
    expect(chromiumState(dir, { PLAYWRIGHT_BROWSERS_PATH: "0" }, "linux", tempDir())).toBe(
      "present",
    );
  });
});
