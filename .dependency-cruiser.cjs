// The kit's own boundaries (WEB_TOPS.md W-16, W-17, W-19). `webtops gate` runs this once, in gate 1.
const TEST = "(\\.test\\.ts|/test-support[^/]*\\.ts)$";
// The presets run in a project that installs the tools they import, so they may name devDependencies.
const PRESETS = "^src/presets/";

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
      name: "no-unresolvable",
      comment: "W-17: an unresolvable import is broken, deep ones too.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-optional-peer-import",
      comment:
        "W-19: an optional peer (React, R3F) is imported only from a react entry or an adapter.",
      severity: "error",
      from: { pathNot: "(^|/)(react|adapters)(/|\\.[cm]?[jt]sx?$)" },
      to: {
        dependencyTypes: ["npm-peer"],
        path: "(^|/)node_modules/(react|react-dom|three|@react-three/[^/]+)(/|$)",
      },
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
      comment:
        "Production code imports only dependencies, never devDependencies. A type-only import is erased, so it may name a tool's types (the complexity counter takes the project's own TypeScript as an argument).",
      severity: "error",
      from: { path: "^src/", pathNot: [TEST, PRESETS] },
      to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "no-non-package-json",
      comment: "Every package the code imports is declared in package.json.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Reserved: the W-22 proof package, the deliberate cheats and the M3 law fixtures are not this kit's code; examples/node-service gates itself.
    exclude: {
      path: "^(probes|fixtures/probe|fixtures/complexity|fixtures/laws|examples)/",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
