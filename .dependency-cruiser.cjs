// The kit's own boundaries (WEB_TOPS.md W-16). `webtops gate` runs this once, in gate 1.
const TEST = "(\\.test\\.ts|/test-support[^/]*\\.ts)$";

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "W-16: no import cycles.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "config-below-cli",
      comment: "src/config is the layer under the commands: it never imports src/cli.",
      severity: "error",
      from: { path: "^src/config/" },
      to: { path: "^src/cli/" },
    },
    {
      name: "not-to-test",
      comment: "Production code never imports a test or a test helper.",
      severity: "error",
      from: { pathNot: TEST },
      to: { path: TEST },
    },
    {
      name: "not-to-dev-dependency",
      comment: "Production code imports only dependencies, never devDependencies.",
      severity: "error",
      from: { path: "^src/", pathNot: TEST },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      name: "no-non-package-json",
      comment: "Every package the code imports is declared in package.json.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "not-to-unresolvable",
      comment: "Every import resolves.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Reserved: the W-22 proof package and the deliberate cheats are not this kit's code.
    exclude: { path: "^(probes|fixtures/probe|fixtures/complexity)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
