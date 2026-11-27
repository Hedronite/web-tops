import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { routes } from "./src/routes.ts";

/**
 * Writes `<route>/index.html` for every route, with its view already in `<main>` and its own title. Any static
 * server then answers each route, and the page reads the same before its JavaScript has run.
 */
function prerender(): Plugin {
  return {
    name: "prerender-routes",
    apply: "build",
    async closeBundle() {
      const dist = join(import.meta.dirname, "dist");
      const shell = await readFile(join(dist, "index.html"), "utf8");
      for (const route of routes()) {
        const view = await route.view();
        const page = shell
          .replace("<title>Example app</title>", `<title>${route.title}</title>`)
          .replace("<main></main>", `<main>${view.default()}</main>`);
        await mkdir(join(dist, route.path), { recursive: true });
        await writeFile(join(dist, route.path, "index.html"), page);
      }
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), prerender()],
  build: { modulePreload: { polyfill: false } },
});
