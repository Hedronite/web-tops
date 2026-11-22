import { join } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { at } from "../config/test-support.ts";
import { eslintPreset } from "./eslint.js";
import { ROOT } from "./test-support-scratch.ts";

const RULE = "@typescript-eslint/no-unsafe-assignment";

async function levelAt(file: string): Promise<unknown> {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    overrideConfig: await eslintPreset({ variant: "base", tsconfigRootDir: ROOT }),
  });
  const config: unknown = await eslint.calculateConfigForFile(join(ROOT, file));
  return at(config, ["rules", RULE]);
}

describe("the base preset's plain-JavaScript block and a page's script block", () => {
  it("turns the type-aware rules off for a config file, which no tsconfig holds", async () => {
    expect(await levelAt("src/loose.js")).toEqual([0]);
    expect(await levelAt("src/loose.cjs")).toEqual([0]);
  });

  it("leaves them at error for page.astro/0.js, a file of its own that the laws layer asks about", async () => {
    expect(await levelAt("src/__webtops_probe__.astro/0.js")).toEqual([2]);
  });
});
