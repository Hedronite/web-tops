import pkg from "../../package.json" with { type: "json" };
import { PROTOCOL } from "../config/protocol.ts";
import { TOOL_PINS } from "../lock/pins.ts";
import type { Io } from "./io.ts";

const byName = ([a]: readonly [string, string], [b]: readonly [string, string]): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** `webtops version`: the protocol, the package, then every pinned tool at its exact version. */
export function runVersionCli(argv: readonly string[], io: Io): Promise<number> {
  if (argv.length > 0) {
    io.err("webtops version: takes no arguments\n");
    return Promise.resolve(2);
  }
  const tools = Object.entries(TOOL_PINS)
    .sort(byName)
    .map(([tool, version]) => `${tool} ${version}\n`);
  io.out(`protocol ${PROTOCOL}\npackage ${pkg.version}\n${tools.join("")}`);
  return Promise.resolve(0);
}
