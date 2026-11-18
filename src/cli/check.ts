import { dirname, resolve } from "node:path";
import { capFor } from "../baseline/cap.ts";
import { baselineHistory } from "../baseline/history.ts";
import { checkConfigFile } from "../config/validate.ts";
import type { Problem, WebTopsConfig } from "../config/types.ts";
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

/** The ref a ratchet run is judged against when the config names none. */
const DEFAULT_BASE = "origin/main";

const baseOf = (config: WebTopsConfig): string => config.gates?.mutation?.base ?? DEFAULT_BASE;

/** The cap a ratchet run holds a new function to; undefined for the modes that read no baseline. */
const ratchetCap = (config: WebTopsConfig): number | undefined =>
  config.enforce === "ratchet" ? capFor(config.class) : undefined;

/**
 * Under `ratchet` the baseline may only tighten across the change: it is held to the merge base's copy
 * (WEB_TOPS.md section 6.7). Other modes read no baseline.
 */
async function historyProblems(config: WebTopsConfig, dir: string): Promise<readonly Problem[]> {
  const cap = ratchetCap(config);
  if (cap === undefined) return [];
  const history = await baselineHistory({
    cwd: dir,
    baselinePath: config.baseline,
    base: baseOf(config),
    cap,
  });
  return history.ok ? [] : history.reasons.map((message) => ({ pointer: "/baseline", message }));
}

type Checked =
  | { readonly ok: true; readonly config: WebTopsConfig }
  | { readonly ok: false; readonly problems: readonly Problem[] };

async function checked(full: string): Promise<Checked> {
  const result = checkConfigFile(full);
  if (!result.ok) return { ok: false, problems: result.problems };
  const problems = await historyProblems(result.value, dirname(full));
  return problems.length === 0 ? { ok: true, config: result.value } : { ok: false, problems };
}

async function check(argv: readonly string[], io: Io): Promise<number> {
  const path = pathFrom(argv);
  if (path === undefined) {
    io.err("usage: webtops check [path]\n");
    return 2;
  }
  const result = await checked(resolve(io.cwd, path));
  if (result.ok) {
    io.out(`${path}: ok (class ${result.config.class}, enforce ${result.config.enforce})\n`);
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
  return check(argv, io);
}
