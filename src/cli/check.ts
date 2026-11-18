import { dirname, resolve } from "node:path";
import { checkConfigFile } from "../config/validate.ts";
import type { Problem } from "../config/types.ts";
import { checkLedger } from "../survivors/check.ts";
import { DEFAULT_LEDGER } from "../survivors/check.ts";
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

/** The survivor ledger's problems as lines, each at `<ledger path>#<pointer>`; none when it is absent or valid. */
function ledgerLines(directory: string, ledger: string | undefined): string[] {
  const named = ledger ?? DEFAULT_LEDGER;
  return checkLedger(directory, named).map(
    (problem) => `  ${named}#${problem.pointer}: ${problem.message}\n`,
  );
}

type Checked = ReturnType<typeof checkConfigFile>;

/** Every problem the config file has, as lines: the schema and semantic ones, or the ledger's when those pass. */
function problemLines(file: string, result: Checked): string[] {
  return result.ok
    ? ledgerLines(dirname(file), result.value.gates?.mutation?.ledger)
    : result.problems.map(line);
}

function check(argv: readonly string[], io: Io): number {
  const path = pathFrom(argv);
  if (path === undefined) {
    io.err("usage: webtops check [path]\n");
    return 2;
  }
  const file = resolve(io.cwd, path);
  const result = checkConfigFile(file);
  const lines = problemLines(file, result);
  if (!result.ok || lines.length > 0) {
    io.err(`${path}: invalid\n${lines.join("")}`);
    return 2;
  }
  io.out(`${path}: ok (class ${result.value.class}, enforce ${result.value.enforce})\n`);
  return 0;
}

/**
 * `webtops check [path]`: the schema, then the semantic checks. Exit 0 valid, 2 invalid or
 * unreadable or a usage error, with one JSON-pointer line per problem on stderr.
 */
export function runCheckCli(argv: readonly string[], io: Io): Promise<number> {
  return Promise.resolve(check(argv, io));
}
