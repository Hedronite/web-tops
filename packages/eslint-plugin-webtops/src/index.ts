import type { ESLint } from "eslint";
import completeTailwindClasses from "./rules/complete-tailwind-classes.ts";
import noUnsanitizedHtml from "./rules/no-unsanitized-html.ts";
import publicEnvOnly from "./rules/public-env-only.ts";

/** The rules behind Web-TOPS laws W-23, W-36 and W-37, under the `webtops` namespace. */
const plugin: ESLint.Plugin = {
  get meta() {
    return { name: "eslint-plugin-webtops" };
  },
  get rules() {
    return {
      "complete-tailwind-classes": completeTailwindClasses,
      "no-unsanitized-html": noUnsanitizedHtml,
      "public-env-only": publicEnvOnly,
    };
  },
};

export default plugin;
