import { field, readConfigDoc } from "../lock/config.ts";
import { resolveReportPath } from "../report/write.ts";
import { DEFAULT_LEDGER } from "../survivors/check.ts";
import { isCalendarDate, utcDate } from "../survivors/dates.ts";
import { parseFlags } from "../survivors/flags.ts";
import type { Flags } from "../survivors/flags.ts";
import type { SurvivorKey } from "../survivors/key.ts";
import { judge } from "../survivors/match.ts";
import { readReportSurvivors } from "../survivors/reportSurvivors.ts";
import type { ReportSurvivors } from "../survivors/reportSurvivors.ts";
import { readLedger, recordEntry } from "../survivors/store.ts";
import type { Judgment, LedgerEntry } from "../survivors/types.ts";
import {
  days,
  keyLine,
  keyObject,
  rowObject,
  rowsOf,
  rowText,
  survivorId,
} from "../survivors/view.ts";
import type { Row } from "../survivors/view.ts";
import type { Io } from "./io.ts";

const USAGE =
  "usage: webtops survivors [list [--json] | explain <id> --reason <text> --owner <text> [--expires YYYY-MM-DD] | expire [--within <days>] [--json]]\n";

const DEFAULT_REPORT = ".web-tops/report.json";
const DEFAULT_WITHIN = 14;
const MIN_ID = 6;

/** The clock a command reads, so a test can pin the day. */
export type Clock = () => Date;

interface Where {
  readonly ledger: string;
  readonly report: string;
}

type Located =
  { readonly ok: true; readonly where: Where } | { readonly ok: false; readonly error: string };

const failure = (io: Io, message: string): number => {
  io.err(`webtops survivors: ${message}\n`);
  return 2;
};

const usageFailure = (io: Io, message: string): number =>
  failure(io, `${message}\n${USAGE.trimEnd()}`);

const ledgerOf = (doc: unknown): string | undefined => {
  const named = field(doc, "gates", "mutation", "ledger") ?? DEFAULT_LEDGER;
  return typeof named === "string" ? named : undefined;
};

/** Where `report.path` lands, the way `gate` and `report` resolve it. */
function reportLocation(cwd: string, doc: unknown, ledger: string): Located {
  const named = field(doc, "report", "path") ?? DEFAULT_REPORT;
  if (typeof named !== "string")
    return { ok: false, error: "web-tops.yaml /report/path must be text" };
  const resolved = resolveReportPath(cwd, named);
  if (!resolved.ok) return { ok: false, error: `web-tops.yaml /report/path: ${resolved.message}` };
  return { ok: true, where: { ledger, report: resolved.path } };
}

/** The ledger path `gates.mutation.ledger` names, and the report path `report.path` names, from web-tops.yaml. */
function locate(cwd: string): Located {
  const config = readConfigDoc(cwd);
  if (config.state === "invalid")
    return { ok: false, error: `web-tops.yaml is not valid YAML: ${config.error}` };
  const doc = config.state === "ok" ? config.doc : undefined;
  const ledger = ledgerOf(doc);
  if (ledger === undefined)
    return { ok: false, error: "web-tops.yaml /gates/mutation/ledger must be text" };
  return reportLocation(cwd, doc, ledger);
}

interface Session {
  readonly ledger: string;
  readonly entries: readonly LedgerEntry[];
  readonly report: ReportSurvivors;
  readonly today: string;
  readonly judgment: Judgment;
  readonly rows: readonly Row[];
}

const pointerLine = (pointer: string, message: string): string =>
  `  ${pointer === "" ? "(document)" : pointer}: ${message}\n`;

/** The ledger, the last report's survivors and the verdict on them, or the exit code after saying why not. */
function open(io: Io, now: Clock): Session | number {
  const located = locate(io.cwd);
  if (!located.ok) return failure(io, located.error);
  const read = readLedger(io.cwd, located.where.ledger);
  if (!read.ok) {
    const lines = read.problems.map((found) => pointerLine(found.pointer, found.message)).join("");
    return failure(io, `${located.where.ledger} is invalid\n${lines.trimEnd()}`);
  }
  const report = readReportSurvivors(located.where.report);
  const survivors = report.ok ? report.survivors : [];
  const today = utcDate(now());
  const judgment = judge(read.entries, survivors, today);
  const rows = rowsOf(read.entries, judgment, today, report.ok);
  return { ledger: located.where.ledger, entries: read.entries, report, today, judgment, rows };
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const survivorLines = (survivors: readonly SurvivorKey[]): string =>
  survivors.map((key) => `  ${keyLine(key)}\n`).join("");

function listText(session: Session): string {
  const { rows, judgment } = session;
  const count = (status: string): number => rows.filter((row) => row.status === status).length;
  const head = `${session.ledger}: ${String(rows.length)} entries, ${String(count("expired"))} expired, ${String(count("stale"))} stale (today ${session.today} UTC)\n`;
  const body = rows.map((row) => `${rowText(row)}\n`).join("");
  const open = session.report.ok
    ? `unexplained survivors in the last report: ${String(judgment.unexplained.length)}\n${survivorLines(judgment.unexplained)}`
    : `${session.report.message}\n`;
  return `${head}${body}${open}`;
}

function listJson(session: Session): string {
  return json({
    ledger: session.ledger,
    today: session.today,
    report: session.report.ok ? "present" : "absent",
    entries: session.rows.map(rowObject),
    unexplained: session.judgment.unexplained.map(keyObject),
  });
}

/** `list [--json]`: the flags, or what is wrong with them. */
function listFlags(argv: readonly string[]) {
  const flags = parseFlags(argv, { values: [], switches: ["--json"] });
  if (typeof flags === "string") return flags;
  return flags.positionals.length > 0 ? "list takes no arguments" : flags;
}

function list(argv: readonly string[], io: Io, now: Clock): number {
  const flags = listFlags(argv);
  if (typeof flags === "string") return usageFailure(io, flags);
  const session = open(io, now);
  if (typeof session === "number") return session;
  io.out(flags.switches.has("--json") ? listJson(session) : listText(session));
  return 0;
}

interface Explanation {
  readonly id: string;
  readonly reason: string;
  readonly owner: string;
  readonly expires: string | undefined;
}

const textFlag = (flags: Flags, name: string): string => flags.values.get(name)?.trim() ?? "";

function idProblem(flags: Flags): string | undefined {
  const [id] = flags.positionals;
  if (id === undefined || flags.positionals.length > 1) return "explain takes one survivor id";
  return id.length < MIN_ID
    ? `a survivor id is at least ${String(MIN_ID)} characters; run webtops survivors list`
    : undefined;
}

const textProblem = (reason: string, owner: string): string | undefined =>
  reason === "" || owner === ""
    ? "--reason and --owner are required and cannot be blank"
    : undefined;

const expiryProblem = (expires: string | undefined, today: string): string | undefined =>
  expires === undefined || (isCalendarDate(expires) && expires >= today)
    ? undefined
    : `--expires must be a real date, YYYY-MM-DD, today (${today}) or later`;

const idOf = (flags: Flags): string => flags.positionals[0] ?? "";

function explanationOf(flags: Flags, today: string): Explanation | string {
  const reason = textFlag(flags, "--reason");
  const owner = textFlag(flags, "--owner");
  const expires = flags.values.get("--expires");
  const wrong = idProblem(flags) ?? textProblem(reason, owner) ?? expiryProblem(expires, today);
  return wrong ?? { id: idOf(flags), reason, owner, expires };
}

/** What the person said, or what is wrong with it: a blank reason or owner, a bad or past date, no id. */
function explanationFrom(argv: readonly string[], today: string): Explanation | string {
  const flags = parseFlags(argv, { values: ["--reason", "--owner", "--expires"], switches: [] });
  return typeof flags === "string" ? flags : explanationOf(flags, today);
}

/** The survivor of the last report that the id names (a prefix of ten hex characters, at least six). */
function survivorFor(report: ReportSurvivors, id: string): SurvivorKey | string {
  if (!report.ok) return report.message;
  const found = report.survivors.filter((key) => survivorId(key).startsWith(id));
  if (found.length > 1) return `${id} names more than one survivor; use more characters`;
  return found[0] ?? `no survivor ${id} in the last report; run webtops survivors list`;
}

interface Chosen {
  readonly key: SurvivorKey;
  readonly entry: LedgerEntry;
}

/** The survivor the id names, with the entry the person's words make of it, or what stops it. */
function choose(argv: readonly string[], session: Session): Chosen | string {
  const said = explanationFrom(argv, session.today);
  if (typeof said === "string") return said;
  const key = survivorFor(session.report, said.id);
  if (typeof key === "string") return key;
  return { key, entry: { key, reason: said.reason, owner: said.owner, expires: said.expires } };
}

const confirmation = (replaced: boolean, key: SurvivorKey): string =>
  `${replaced ? "replaced" : "explained"} ${keyLine(key)}\n`;

function explain(argv: readonly string[], io: Io, now: Clock): number {
  const session = open(io, now);
  if (typeof session === "number") return session;
  const chosen = choose(argv, session);
  if (typeof chosen === "string") return failure(io, chosen);
  const recorded = recordEntry(io.cwd, session.ledger, chosen.entry);
  if (!recorded.ok) return failure(io, recorded.message);
  io.out(confirmation(recorded.replaced, chosen.key));
  return 0;
}

interface ExpireOptions {
  readonly within: number;
  readonly json: boolean;
}

/** The days a person has to act: `--within`, a whole number of days. */
function withinFrom(value: string | undefined): number | undefined {
  if (value === undefined) return DEFAULT_WITHIN;
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

function expireOptions(argv: readonly string[]): ExpireOptions | string {
  const flags = parseFlags(argv, { values: ["--within"], switches: ["--json"] });
  if (typeof flags === "string") return flags;
  const within = withinFrom(flags.values.get("--within"));
  if (within === undefined || flags.positionals.length > 0)
    return "expire takes only --within <days> and --json";
  return { within, json: flags.switches.has("--json") };
}

const expiring = (row: Row, within: number): boolean =>
  row.status !== "expired" && row.daysLeft !== undefined && row.daysLeft <= within;

function expireText(expired: readonly Row[], soon: readonly Row[], within: number): string {
  if (expired.length + soon.length === 0) {
    return `no entry has expired, and none expires within ${days(within)}\n`;
  }
  const head = `${String(expired.length)} expired, ${String(soon.length)} expiring within ${days(within)}\n`;
  return head + [...expired, ...soon].map((row) => `${rowText(row)}\n`).join("");
}

interface ExpireReport {
  readonly text: string;
  readonly failed: boolean;
}

function expireReport(session: Session, options: ExpireOptions): ExpireReport {
  const expired = session.rows.filter((row) => row.status === "expired");
  const soon = session.rows.filter((row) => expiring(row, options.within));
  const asJson = json({
    today: session.today,
    within: options.within,
    expired: expired.map(rowObject),
    expiring: soon.map(rowObject),
  });
  return {
    text: options.json ? asJson : expireText(expired, soon, options.within),
    failed: expired.length > 0,
  };
}

function expire(argv: readonly string[], io: Io, now: Clock): number {
  const options = expireOptions(argv);
  if (typeof options === "string") return usageFailure(io, options);
  const session = open(io, now);
  if (typeof session === "number") return session;
  const report = expireReport(session, options);
  io.out(report.text);
  return report.failed ? 1 : 0;
}

type Command = (argv: readonly string[], io: Io, now: Clock) => number;

const COMMANDS: ReadonlyMap<string, Command> = new Map<string, Command>([
  ["list", list],
  ["explain", explain],
  ["expire", expire],
]);

/** A bare `survivors`, or one that starts with an option, is `list`. */
function route(argv: readonly string[]): {
  readonly name: string;
  readonly args: readonly string[];
} {
  const [first] = argv;
  const named = first !== undefined && !first.startsWith("--");
  return named ? { name: first, args: argv.slice(1) } : { name: "list", args: argv };
}

/**
 * `webtops survivors [list | explain | expire]` (WEB_TOPS.md section 12): the mutation ledger,
 * `.web-tops/survivors.yaml` or `gates.mutation.ledger`. `list` describes it (and the last report's
 * unexplained survivors), `explain` records an entry for one of them, `expire` reports what has expired
 * (exit 1) or will soon, and changes nothing. A bare `survivors` is `list`. Exit 0, 1 for an expired entry,
 * 2 for an unreadable ledger or a usage error.
 */
export function runSurvivorsCli(
  argv: readonly string[],
  io: Io,
  now: Clock = () => new Date(),
): Promise<number> {
  const { name, args } = route(argv);
  const command = COMMANDS.get(name);
  if (command === undefined)
    return Promise.resolve(usageFailure(io, `unknown subcommand "${name}"`));
  return Promise.resolve(command(args, io, now));
}
