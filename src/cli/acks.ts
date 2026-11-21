import { execFileSync } from "node:child_process";
import { collectAcks } from "../acks/collect.ts";
import { ledgerPath } from "../acks/files.ts";
import type { AckProblem, Collected } from "../acks/collect.ts";
import type { Ack } from "../acks/apply.ts";
import { catalogSeverity } from "../acks/severity.ts";
import type { SeverityOf } from "../acks/severity.ts";
import type { Io } from "./io.ts";

const USAGE = "usage: webtops acks [--json]\n";

/** The tracked files of the project (the list ends with an empty name, which no reader opens), or undefined when `git ls-files` cannot say. */
function trackedFiles(cwd: string): string[] | undefined {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    return out.split("\0");
  } catch {
    return undefined;
  }
}

const where = (item: { readonly file: string; readonly line?: number }): string =>
  item.line === undefined ? item.file : `${item.file}:${String(item.line)}`;

const ackLine = (ack: Ack): string => `  ${ack.law}  ${where(ack)}  ${ack.source}  ${ack.reason}`;

const problemLine = (problem: AckProblem): string =>
  `  ${where(problem)}  ${problem.rule}  ${problem.message}`;

function text(found: Collected): string {
  const comments = found.acks.filter((ack) => ack.source === "comment").length;
  const head = `acks: ${String(found.acks.length)} (${String(comments)} comments, ${String(found.acks.length - comments)} ledger entries)`;
  const problems =
    found.problems.length === 0 ? [] : ["problems:", ...found.problems.map(problemLine)];
  return `${[head, ...found.acks.map(ackLine), ...problems].join("\n")}\n`;
}

function report(found: Collected, json: boolean, io: Io): number {
  io.out(json ? `${JSON.stringify(found, null, 2)}\n` : text(found));
  return found.problems.length === 0 ? 0 : 1;
}

/** `--json` or nothing; any other argument is a usage error. */
function formatOf(argv: readonly string[]): "text" | "json" | undefined {
  if (argv.length === 0) return "text";
  return argv.length === 1 && argv[0] === "--json" ? "json" : undefined;
}

/**
 * `webtops acks [--json]`: the acknowledgements of soft laws in the project (WEB_TOPS.md section 8.1), the comments in
 * its tracked files and the entries of its ledger, with every one that is not well formed or is of a hard law or an id
 * that is not a law. Exits 1 when there is one.
 */
export function runAcksCli(
  argv: readonly string[],
  io: Io,
  severity: () => SeverityOf = catalogSeverity,
): Promise<number> {
  const format = formatOf(argv);
  if (format === undefined) {
    io.err(`webtops acks: bad arguments\n${USAGE}`);
    return Promise.resolve(2);
  }
  const files = trackedFiles(io.cwd);
  if (files === undefined) {
    io.err("webtops acks: cannot list the tracked files: this is not a git repository\n");
    return Promise.resolve(2);
  }
  return Promise.resolve(
    report(collectAcks(io.cwd, files, ledgerPath(io.cwd), severity()), format === "json", io),
  );
}
