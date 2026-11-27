/**
 * The axe run of WEB_TOPS.md section 7: the WCAG 2.0, 2.1 and 2.2 A and AA tags, and `target-size`, which axe ships
 * switched off, switched on by its id.
 */
export const axeOptions = (): object => ({
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
  rules: { "target-size": { enabled: true } },
});

/** One fixed desktop viewport, so a run does not depend on the machine's. */
export const viewport = (): object => ({ width: 1280, height: 720 });

/** The packages the driver loads from the project. */
export const toolPackages = (): { readonly playwright: string; readonly axe: string } => ({
  playwright: "@playwright/test",
  axe: "@axe-core/playwright",
});
