import type { ESLint } from "eslint";
import astroAssetsImage from "./rules/astro-assets-image.ts";
import astroClientLoadAck from "./rules/astro-client-load-ack.ts";
import astroFrontmatterSize from "./rules/astro-frontmatter-size.ts";
import completeTailwindClasses from "./rules/complete-tailwind-classes.ts";
import noUnsanitizedHtml from "./rules/no-unsanitized-html.ts";
import publicEnvOnly from "./rules/public-env-only.ts";

/** The rules behind Web-TOPS laws W-23, W-28, W-30, W-31, W-36 and W-37, under the `webtops` namespace. */
const plugin: ESLint.Plugin = {
  meta: { name: "eslint-plugin-webtops" },
  rules: {
    "astro-assets-image": astroAssetsImage,
    "astro-client-load-ack": astroClientLoadAck,
    "astro-frontmatter-size": astroFrontmatterSize,
    "complete-tailwind-classes": completeTailwindClasses,
    "no-unsanitized-html": noUnsanitizedHtml,
    "public-env-only": publicEnvOnly,
  },
};

export default plugin;
