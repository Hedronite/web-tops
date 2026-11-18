import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Reserved: probes and the deliberate cheats are data, never collected as this kit's tests.
    exclude: [
      ...configDefaults.exclude,
      "probes/**",
      "fixtures/probe/**",
      "fixtures/complexity/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/test-support*.ts", "src/**/*.d.ts"],
    },
  },
});
