import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real git, bun and ESLint processes run in the gate, src/cli and src/diff tests; the macOS runner is slow.
    testTimeout: 30_000,
    // Builds eslint-plugin-webtops, which the web-tops/eslint preset imports from its build.
    globalSetup: ["./vitest.global-setup.js"],
    include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
    // Reserved: probes and the deliberate cheats are data, never collected as this kit's tests.
    exclude: [
      ...configDefaults.exclude,
      "probes/**",
      "fixtures/probe/**",
      "fixtures/complexity/**",
      // Reserved (M3): bad twins break rules on purpose; the example gates itself (G11).
      "fixtures/laws/**",
      "examples/node-service/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts", "packages/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/test-support*.ts",
        "src/**/*.d.ts",
        "packages/**/*.test.ts",
        "packages/**/*.d.ts",
      ],
    },
  },
});
