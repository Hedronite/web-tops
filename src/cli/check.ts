import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { namedLedger } from "../acks/files.ts";
import { ackLedgerReport } from "../acks/report.ts";
import { catalogSeverity } from "../acks/severity.ts";
import { configHistoryProblems } from "../baseline/config-history.ts";
import { checkConfigFile } from "../config/validate.ts";
import type { Problem, WebTopsConfig } from "../config/types.ts";
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

/** The problems of the survivor ledger, else those of the ack ledger (section 8.1), headed with the ledger's path; none when both are sound. */
function ledgersReport(directory: string, config: WebTopsConfig): string | undefined {
  return (
    ledgerReport(directory, ledgerPathOf(config)) ??
    ackLedgerReport(directory, namedLedger(config), catalogSeverity)
  );
}

type Checked =
  | { readonly ok: true; readonly config: WebTopsConfig }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** The config is valid, and under `ratchet` its baseline only tightens across the change. */
async function checked(full: string): Promise<Checked> {
  const result = checkConfigFile(full);
  if (!result.ok) return { ok: false, problems: result.problems };
  const problems = await configHistoryProblems(result.value, dirname(full));
  return problems.length === 0 ? { ok: true, config: result.value } : { ok: false, problems };
}

/** Under `ratchet` with no baseline yet: how to take the first one (WEB_TOPS.md section 6.7). */
function bootstrapNote(config: WebTopsConfig, dir: string): string {
  const bare = config.enforce === "ratchet" && !existsSync(resolve(dir, config.baseline));
  return bare
    ? "; no baseline yet: run webtops gate --all --keep-going, then webtops baseline"
    : "";
}

async function check(argv: readonly string[], io: Io): Promise<number> {
  const path = pathFrom(argv);
  if (path === undefined) {
    io.err("usage: webtops check [path]\n");
    return 2;
  }
  const file = resolve(io.cwd, path);
  const result = await checked(file);
  if (!result.ok) {
    io.err(`${path}: invalid\n${result.problems.map(line).join("")}`);
    return 2;
  }
  const ledger = ledgersReport(dirname(file), result.config);
  if (ledger !== undefined) {
    io.err(ledger);
    return 2;
  }
  const note = bootstrapNote(result.config, dirname(file));
  io.out(`${path}: ok (class ${result.config.class}, enforce ${result.config.enforce}${note})\n`);
  return 0;
}

/**
 * `webtops check [path]`: the schema, then the semantic checks. Exit 0 valid, 2 invalid or
 * unreadable or a usage error, with one JSON-pointer line per problem on stderr.
 */
export function runCheckCli(argv: readonly string[], io: Io): Promise<number> {
  return check(argv, io);
}
