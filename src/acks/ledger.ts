import { existsSync, readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { ajv, toProblems } from "../config/ajv.ts";
import type { Problem } from "../config/types.ts";
import { resolveLedgerPath } from "../survivors/path.ts";
import { isCalendarDate } from "../survivors/dates.ts";
import schema from "../../schema/acks.schema.json" with { type: "json" };

/** One entry of `.web-tops/acks.yaml`: every finding of `law` in `file` is acknowledged. */
export interface LedgerAck {
  readonly law: string;
  readonly file: string;
  readonly reason: string;
  readonly owner: string;
  readonly expires?: string;
}

interface Ledger {
  readonly version: 1;
  readonly acks: readonly LedgerAck[];
}

export type AckLedgerRead =
  | { readonly ok: true; readonly acks: readonly LedgerAck[] }
  | { readonly ok: false; readonly problems: readonly Problem[] };

const validate = ajv.compile<Ledger>(schema);

const refused = (message: string): AckLedgerRead => ({
  ok: false,
  problems: [{ pointer: "", message }],
});

const firstLine = (message: string): string => message.split("\n")[0] ?? message;

/** The two rules a schema cannot state: a real calendar date, and one entry for each law and file. */
function entryProblems(acks: readonly LedgerAck[]): Problem[] {
  const seen = new Set<string>();
  return acks.flatMap((ack, index): Problem[] => {
    const at = `/acks/${String(index)}`;
    const key = `${ack.law} ${ack.file}`;
    const repeated = seen.has(key);
    seen.add(key);
    return [
      ...(ack.expires === undefined || isCalendarDate(ack.expires)
        ? []
        : [
            { pointer: `${at}/expires`, message: "expires must be a real date written YYYY-MM-DD" },
          ]),
      ...(repeated
        ? [{ pointer: at, message: `${ack.law} is acknowledged twice for ${ack.file}` }]
        : []),
    ];
  });
}

function checked(value: Ledger): AckLedgerRead {
  const problems = entryProblems(value.acks);
  return problems.length === 0 ? { ok: true, acks: value.acks } : { ok: false, problems };
}

function parsed(text: string): AckLedgerRead {
  const doc = parseDocument(text);
  const issue = [...doc.errors, ...doc.warnings][0];
  if (issue !== undefined) return refused(firstLine(issue.message));
  const value: unknown = doc.toJS();
  if (value === null) return { ok: true, acks: [] };
  return validate(value) ? checked(value) : { ok: false, problems: toProblems(validate.errors) };
}

/**
 * Reads the ledger the config names (`laws.ack_ledger`). No file is an empty ledger, and so is a file that is empty or
 * only comments; a path that leaves the project, a link or a directory is refused, as for the survivor ledger.
 */
export function readAckLedger(directory: string, path: string): AckLedgerRead {
  const located = resolveLedgerPath(directory, path);
  if (!located.ok) return refused(located.message);
  if (!existsSync(located.path)) return { ok: true, acks: [] };
  return parsed(readFileSync(located.path, "utf8"));
}
