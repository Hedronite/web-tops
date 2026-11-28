import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      // The entry wires the DOM; the build's routes and views are tested without one.
      exclude: ["src/**/*.test.ts", "src/main.ts"],
    },
  },
});
