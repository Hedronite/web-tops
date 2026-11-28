import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  // `<route>/index.html`, so every route is a file any static server answers.
  build: { format: "directory" },
  vite: { plugins: [tailwindcss()] },
});
