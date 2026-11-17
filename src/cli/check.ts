import { resolve } from "node:path";
import { checkConfigFile } from "../config/validate.ts";
import type { Io } from "./io.ts";

const DEFAULT_PATH = "web-tops.yaml";

/**
 * `webtops check [path]`: the schema, then the semantic checks. Exit 0 valid, 2 invalid or
 * unreadable or a usage error, with one JSON-pointer line per problem on stderr.
 */
export function runCheckCli(argv: readonly string[], io: Io): Promise<number> {
  const [first, ...extra] = argv;
  if (extra.length > 0 || first?.startsWith("-") === true) {
    io.err("usage: webtops check [path]\n");
    return Promise.resolve(2);
  }
  const path = first ?? DEFAULT_PATH;
  const result = checkConfigFile(resolve(io.cwd, path));
  if (result.ok) {
    io.out(`${path}: ok (class ${result.value.class}, enforce ${result.value.enforce})\n`);
    return Promise.resolve(0);
  }
  const lines = result.problems.map(
    (problem) =>
      `  ${problem.pointer === "" ? "(document)" : problem.pointer}: ${problem.message}\n`,
  );
  io.err(`${path}: invalid\n${lines.join("")}`);
  return Promise.resolve(2);
}
