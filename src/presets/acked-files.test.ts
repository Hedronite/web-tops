import { afterEach, describe, expect, it, vi } from "vitest";
import { eslintPreset } from "./eslint.js";

/** W-28's setting in the preset for an astro-site, as the config states it. */
async function settingOf(rule: string): Promise<unknown> {
  const config = await eslintPreset({
    variant: "astro",
    tsconfigRootDir: process.cwd(),
    class: "astro-site",
  });
  const entry = config.find((one) => one.rules !== undefined && rule in one.rules);
  return entry?.rules?.[rule];
}

const LOAD = "webtops/astro-client-load-ack";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the files the ack ledger covers reach W-28's rule from the gate's environment", () => {
  it("leaves the rule at error when the gate listed no file", async () => {
    vi.stubEnv("WEBTOPS_ACKED_FILES", undefined);
    expect(await settingOf(LOAD)).toBe("error");
  });

  it("gives the rule the files listed for W-28", async () => {
    vi.stubEnv(
      "WEBTOPS_ACKED_FILES",
      JSON.stringify({ "W-28": ["src/page.astro", "src/b.astro"] }),
    );
    expect(await settingOf(LOAD)).toEqual([
      "error",
      { ackedFiles: ["src/page.astro", "src/b.astro"] },
    ]);
  });

  it("keeps only the strings of the list", async () => {
    vi.stubEnv("WEBTOPS_ACKED_FILES", JSON.stringify({ "W-28": ["src/page.astro", 3, null] }));
    expect(await settingOf(LOAD)).toEqual(["error", { ackedFiles: ["src/page.astro"] }]);
  });

  it.each([
    ["an empty list", JSON.stringify({ "W-28": [] })],
    ["files of another law", JSON.stringify({ "W-30": ["src/page.astro"] })],
    ["a value that is not a list", JSON.stringify({ "W-28": "src/page.astro" })],
    ["text that is not JSON", "src/page.astro"],
    ["an empty value", ""],
  ])("leaves the rule at error for %s", async (_name, value) => {
    vi.stubEnv("WEBTOPS_ACKED_FILES", value);
    expect(await settingOf(LOAD)).toBe("error");
  });

  it("leaves every other rule at error, whatever the gate listed", async () => {
    vi.stubEnv("WEBTOPS_ACKED_FILES", JSON.stringify({ "W-28": ["src/page.astro"] }));
    expect(await settingOf("webtops/astro-assets-image")).toBe("error");
    expect(await settingOf("webtops/no-unsanitized-html")).toBe("error");
  });
});
