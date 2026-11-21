import { ackDirectivesIn, readsDirectives } from "../census/directives.ts";
import { readSource, withinSource } from "../census/files.ts";
import type { Ack } from "./apply.ts";
import { fromLedger, lawProblem } from "./apply.ts";
import { parseAck } from "./comment.ts";
import { readAckLedger } from "./ledger.ts";
import type { SeverityOf } from "./severity.ts";

/** Something wrong with an acknowledgement: where it is, the rule that names it and what it says. */
export interface AckProblem {
  readonly file: string;
  readonly line?: number;
  readonly rule: string;
  readonly message: string;
}

export interface Collected {
  readonly acks: readonly Ack[];
  readonly problems: readonly AckProblem[];
}

/** The `webtops-ack` comments of one file, each as an acknowledgement or the problem that says why it is not one. */
function fromFile(cwd: string, file: string): Collected {
  const text = readSource(cwd, file);
  const found = text === undefined ? [] : ackDirectivesIn(file, text);
  const acks: Ack[] = [];
  const problems: AckProblem[] = [];
  for (const directive of found) {
    const parsed = parseAck(directive.body);
    if (parsed.ok) {
      acks.push({
        source: "comment",
        law: parsed.law,
        file,
        line: directive.line,
        reason: parsed.reason,
      });
    } else {
      problems.push({ file, line: directive.line, rule: parsed.rule, message: parsed.message });
    }
  }
  return { acks, problems };
}

type Ledger = ReturnType<typeof readAckLedger>;

/** What a ledger gives: its entries as acknowledgements, or the one problem of a ledger that cannot be read. */
export function fromLedgerFile(read: Ledger, ledger: string): Collected {
  if (read.ok) return { acks: read.acks.map(fromLedger), problems: [] };
  const message = read.problems
    .map((found) => `${found.pointer || ledger}: ${found.message}`)
    .join("; ");
  return { acks: [], problems: [{ file: ledger, rule: "ack-ledger-unreadable", message }] };
}

/** Where a problem of an acknowledgement is: a comment's own line, or the ledger, naming the file of the entry. */
export function problemAt(
  ack: Ack,
  problem: { readonly rule: string; readonly message: string },
  ledger: string,
): AckProblem {
  if (ack.source === "ledger") {
    return { file: ledger, rule: problem.rule, message: `${ack.file}: ${problem.message}` };
  }
  return {
    file: ack.file,
    ...(ack.line === undefined ? {} : { line: ack.line }),
    rule: problem.rule,
    message: problem.message,
  };
}

/** The acknowledgements of a law that is unknown or hard (section 8.1) as problems: nothing turns a hard law's break into a pass. */
export function lawProblems(
  acks: readonly Ack[],
  severity: SeverityOf,
  ledger: string,
): AckProblem[] {
  return acks.flatMap((ack) => {
    const problem = lawProblem(ack.law, severity);
    return problem === undefined ? [] : [problemAt(ack, problem, ledger)];
  });
}

/**
 * Every acknowledgement of a project (WEB_TOPS.md section 8.1): the comments of the tracked source files, and the
 * entries of the ledger at `ledger`. What is not a well-formed acknowledgement, one of a hard law or of an id that is
 * not a law, and a ledger that cannot be read, are problems, never silently dropped.
 */
export function collectAcks(
  cwd: string,
  files: readonly string[],
  ledger: string,
  severity: SeverityOf,
): Collected {
  const parts = files
    .filter((file) => readsDirectives(file) && withinSource(file))
    .map((file) => fromFile(cwd, file));
  parts.push(fromLedgerFile(readAckLedger(cwd, ledger), ledger));
  const acks = parts.flatMap((part) => part.acks);
  const wrong = lawProblems(acks, severity, ledger);
  return {
    acks: acks.filter((ack) => lawProblem(ack.law, severity) === undefined),
    problems: [...parts.flatMap((part) => part.problems), ...wrong],
  };
}
