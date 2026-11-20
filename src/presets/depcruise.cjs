// The dependency-cruiser preset behind `web-tops/depcruise` (WEB_TOPS.md sections 3.1 and 8.2).
// W-16: no import cycles.
// W-17: no deep imports into another package's internals; imports go through `exports`. The
// resolver reads each package's `exports`, so an import through a path it does not expose cannot be
// resolved and fails at no-unresolvable. A rule on the resolved path would flag every normal import,
// because a package's own types resolve into its dist.
// W-19: React and R3F, when a package declares them as peers, are imported only from its `react`
// entries and its `adapters`, the only places that may need them (WEB_TOPS.md section 8.2).
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
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
