import { field, readConfigDoc } from "../lock/config.ts";
import type { ConfigRead } from "../lock/config.ts";
import type { ReportFormat } from "../report/render.ts";
import { loadReport, renderReport } from "../report/render.ts";
import { resolveReportPath } from "../report/write.ts";
import type { Io } from "./io.ts";

const USAGE = "usage: webtops report [--format text|json]\n";
const DEFAULT_PATH = ".web-tops/report.json";

const inlineValue = (arg: string | undefined): string | undefined =>
  arg?.startsWith("--format=") === true ? arg.slice("--format=".length) : undefined;

/** The text after `--format`, in either spelling: `--format=json` or `--format json`. */
function formatValue(argv: readonly string[]): string | undefined {
  if (argv.length === 1) return inlineValue(argv[0]);
  return argv.length === 2 && argv[0] === "--format" ? argv[1] : undefined;
}

function parseFormat(argv: readonly string[]): ReportFormat | undefined {
  if (argv.length === 0) return "text";
  const value = formatValue(argv);
  return value === "text" || value === "json" ? value : undefined;
}

type Located =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string };

/** What `report.path` says: the default when there is no config or no key, else the text, undefined when it is not text. */
function namedPath(config: ConfigRead): string | undefined {
  if (config.state !== "ok") return DEFAULT_PATH;
  const named = field(config.doc, "report", "path");
  if (named === undefined) return DEFAULT_PATH;
  return typeof named === "string" ? named : undefined;
}

/** The report file: `report.path` from web-tops.yaml, resolved the way `gate` resolves it, inside the config directory. */
function locate(cwd: string): Located {
  const config = readConfigDoc(cwd);
  if (config.state === "invalid") {
    return { ok: false, error: `web-tops.yaml is not valid YAML: ${config.error}` };
  }
  const named = namedPath(config);
  if (named === undefined) return { ok: false, error: "web-tops.yaml /report/path: must be text" };
  const resolved = resolveReportPath(cwd, named);
  return resolved.ok
    ? resolved
    : { ok: false, error: `web-tops.yaml /report/path: ${resolved.message}` };
}

function reportCommand(argv: readonly string[], io: Io): number {
  const format = parseFormat(argv);
  if (format === undefined) {
    io.err(`webtops report: bad arguments\n${USAGE}`);
    return 2;
  }
  const located = locate(io.cwd);
  if (!located.ok) {
    io.err(`webtops report: ${located.error}\n`);
    return 2;
  }
  const loaded = loadReport(located.path);
  if (!loaded.ok) {
    io.err(`webtops report: ${loaded.error}\n`);
    return 2;
  }
  io.out(renderReport(loaded.report, format));
  return 0;
}

/** `webtops report [--format text|json]`: renders the last report. It is a viewer: it exits 0 whatever the stored verdict. */
export function runReportCli(argv: readonly string[], io: Io): Promise<number> {
  return Promise.resolve(reportCommand(argv, io));
}
