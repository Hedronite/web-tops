import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real git, bun and ESLint processes run in the gate, src/cli and src/diff tests; the macOS runner is slow.
    testTimeout: 30_000,
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
