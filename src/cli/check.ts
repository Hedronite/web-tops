import { dirname, resolve } from "node:path";
import { checkConfigFile } from "../config/validate.ts";
import type { Problem } from "../config/types.ts";
import { checkLedger, DEFAULT_LEDGER } from "../survivors/check.ts";
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

/** The ledger path the config names, else the default. */
const ledgerPathOf = (config: {
  readonly gates?: { readonly mutation?: { readonly ledger?: string } };
}): string => config.gates?.mutation?.ledger ?? DEFAULT_LEDGER;

/** The survivor ledger's problems, headed with the ledger's own path; none when it is absent or valid. */
function ledgerReport(directory: string, named: string): string | undefined {
  const problems = checkLedger(directory, named);
  if (problems.length === 0) return undefined;
  return `${named}: invalid\n${problems.map(line).join("")}`;
}

function check(argv: readonly string[], io: Io): number {
  const path = pathFrom(argv);
  if (path === undefined) {
    io.err("usage: webtops check [path]\n");
    return 2;
  }
  const file = resolve(io.cwd, path);
  const result = checkConfigFile(file);
  if (!result.ok) {
    io.err(`${path}: invalid\n${result.problems.map(line).join("")}`);
    return 2;
  }
  const ledger = ledgerReport(dirname(file), ledgerPathOf(result.value));
  if (ledger !== undefined) {
    io.err(ledger);
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
