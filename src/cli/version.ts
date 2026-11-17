import pkg from "../../package.json" with { type: "json" };
import { PROTOCOL } from "../config/protocol.ts";
import type { Io } from "./io.ts";

export function runVersionCli(_argv: readonly string[], io: Io): Promise<number> {
  io.out(`protocol ${PROTOCOL}\npackage ${pkg.version}\n`);
  return Promise.resolve(0);
}
