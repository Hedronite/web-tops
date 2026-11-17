import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home has no violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).exclude([".legacy-banner", "#ad"]).analyze();
  expect(results.violations).toEqual([]);
});
