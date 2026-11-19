import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

// Builds eslint-plugin-webtops before the tests run. The `web-tops/eslint` preset imports the plugin's
// build, and the build is not tracked, so every test that loads the preset needs it on disk. The
// build skips type checks: the gate's own `tsc` run checks the plugin's types, and a type check
// would fail on the instrumented sources inside the mutation sandbox.
export default function setup() {
  const root = import.meta.dirname;
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  const project = join(root, "packages", "eslint-plugin-webtops", "tsconfig.build.json");
  const build = spawnSync(process.execPath, [tsc, "-p", project, "--noCheck"], {
    cwd: root,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(`building eslint-plugin-webtops failed:\n${build.stdout}${build.stderr}`);
  }
}
