import { resolve } from "node:path";
import { checkConfigFile } from "../config/validate.ts";
import type { Problem } from "../config/types.ts";
import type { Io } from "./io.ts";

const DEFAULT_PATH = "web-tops.yaml";

function isFlag(argument: string | undefined): boolean {
  return argument?.startsWith("-") === true;
}

/** The config path argv names, the default for none, or undefined when argv is not `[path]`. */
function pathFrom(argv: readonly string[]): string | undefined {
  const [first, ...extra] = argv;
  if (extra.length > 0 || isFlag(first)) return undefined;
  return first ?? DEFAULT_PATH;
}

function line(problem: Problem): string {
  return `  ${problem.pointer === "" ? "(document)" : problem.pointer}: ${problem.message}\n`;
}

function check(argv: readonly string[], io: Io): number {
  const path = pathFrom(argv);
  if (path === undefined) {
    io.err("usage: webtops check [path]\n");
    return 2;
  }
  const result = checkConfigFile(resolve(io.cwd, path));
  if (result.ok) {
    io.out(`${path}: ok (class ${result.value.class}, enforce ${result.value.enforce})\n`);
    return 0;
  }
  io.err(`${path}: invalid\n${result.problems.map(line).join("")}`);
  return 2;
}

/**
 * `webtops check [path]`: the schema, then the semantic checks. Exit 0 valid, 2 invalid or
 * unreadable or a usage error, with one JSON-pointer line per problem on stderr.
 */
export function runCheckCli(argv: readonly string[], io: Io): Promise<number> {
  return Promise.resolve(check(argv, io));
}
