import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import { join } from "node:path";
import { diffExit, diffJson, diffText } from "../lawdiff/format.ts";
import { checkout, mergeBase, renames, type Where } from "../lawdiff/git.ts";
import { githubApi } from "../lawdiff/github.ts";
import { labelAuthority, type Api } from "../lawdiff/label.ts";
import { lawDiff, type Deps } from "../lawdiff/run.ts";
import { snapshotOf } from "../lawdiff/snapshot.ts";
import type { DiffReport } from "../lawdiff/types.ts";
import { parseFlags } from "../survivors/flags.ts";
import type { Io } from "./io.ts";

const USAGE = "usage: webtops law-diff <base> <head> [--json] [--label-present]\n";

const failure = (io: Io, message: string): number => {
  io.err(`webtops law-diff: ${message}\n`);
  return 2;
};

/** The diff's dependencies over a real repository: `git` for the refs, and each checkout read with its own tools. */
export function depsFor(where: Where): Deps {
  return {
    mergeBase: (base, head) => mergeBase(where, base, head),
    checkout: (ref) => checkout(where, ref),
    renames: (base, head) => renames(where, base, head),
    snapshot: (dir, extra) =>
      snapshotOf(
        { cwd: dir, env: where.env, exec: where.exec, outDir: join(dir, ".web-tops", "out") },
        extra,
      ),
  };
}

/**
 * The API the workflow gives the command: a token, the repository and the pull request. A local run has none, and
 * trusts `--label-present`; with the API, only the label the workflow saw on the PR counts, and who applied it is asked.
 */
export function apiOf(env: Readonly<Record<string, string | undefined>>): Api | undefined {
  const token = env["GITHUB_TOKEN"];
  return present(token) && present(env["GITHUB_REPOSITORY"]) && present(env["PR_NUMBER"])
    ? githubApi(token)
    : undefined;
}

const present = (value: string | undefined): value is string => value !== undefined && value !== "";

/** The label is on the PR when the workflow sets WEBTOPS_PROTOCOL_CHANGE_LABEL to 1, or, in a local run, `--label-present` says so. */
const labelOn = (switches: ReadonlySet<string>, io: Io, api: Api | undefined): boolean =>
  io.env["WEBTOPS_PROTOCOL_CHANGE_LABEL"] === "1" ||
  (api === undefined && switches.has("--label-present"));

interface Asked {
  readonly base: string;
  readonly head: string;
  readonly json: boolean;
  readonly label: boolean;
}

const dashed = (ref: string): boolean => ref.startsWith("-");

const checked = (base: string, head: string): readonly [string, string] | string =>
  dashed(base) || dashed(head) ? "a ref cannot start with a dash" : [base, head];

/** The two refs, when exactly two were given and neither can be taken for an option. */
function refsOf(positionals: readonly string[]): readonly [string, string] | string {
  const [base, head] = positionals;
  if (positionals.length !== 2 || base === undefined || head === undefined) {
    return "law-diff takes a base and a head";
  }
  return checked(base, head);
}

/** What was asked, or what is wrong with it. */
function asked(argv: readonly string[], io: Io, api: Api | undefined): Asked | string {
  const flags = parseFlags(argv, { switches: ["--json", "--label-present"] });
  if (typeof flags === "string") return flags;
  const refs = refsOf(flags.positionals);
  if (typeof refs === "string") return refs;
  return {
    base: refs[0],
    head: refs[1],
    json: flags.switches.has("--json"),
    label: labelOn(flags.switches, io, api),
  };
}

/**
 * `webtops law-diff <base> <head>`: fails a PR that weakens a law, a rule, a compiler flag, a floor or a budget,
 * unless the protocol-change label excuses it (WEB_TOPS.md section 11). Exit 0 nothing weakened or excused, 1
 * weakened, 2 a usage problem or a ref that cannot be read.
 */
export async function runLawDiffCli(
  argv: readonly string[],
  io: Io,
  exec: Exec = realExec,
): Promise<number> {
  return runWith(argv, io, exec, apiOf(io.env));
}

/** The command over an API of its own, which a test gives it, or none for a run that trusts the label. */
export async function runWith(
  argv: readonly string[],
  io: Io,
  exec: Exec,
  api: Api | undefined,
): Promise<number> {
  const wanted = asked(argv, io, api);
  if (typeof wanted === "string") return failure(io, `${wanted}\n${USAGE.trimEnd()}`);
  const done = await lawDiff(depsFor({ cwd: io.cwd, env: io.env, exec }), wanted.base, wanted.head);
  return done.ok ? print(io, wanted, done.report, api) : failure(io, done.message);
}

async function print(
  io: Io,
  wanted: Asked,
  report: DiffReport,
  api: Api | undefined,
): Promise<number> {
  const authority = await labelAuthority({
    labelPresent: wanted.label,
    ...(api === undefined
      ? {}
      : { api, repo: io.env["GITHUB_REPOSITORY"], pull: io.env["PR_NUMBER"] }),
  });
  io.out(wanted.json ? diffJson(report, authority) : diffText(report, authority));
  return diffExit(report, authority);
}
