import type { Cell, Row } from "./types.ts";

export interface EngineRows {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly rows: readonly Row[];
}

const MARK: Record<Cell, string> = {
  pass: "ok",
  fail: "FAIL",
  "not-implemented": "n/i",
  error: "ERR",
};

function cell(row: Row | undefined): string {
  if (row === undefined) return "";
  return row.cell === "not-implemented" ? "n/i | n/i" : seen(row);
}

function seen(row: Row): string {
  return `${row.fires_on_bad ? "fires" : "silent"} | ${row.quiet_on_clean ? "quiet" : "FIRES"}`;
}

/** The per-rule table: bad and clean outcome per engine, then the row's verdict per engine. */
export function renderTable(engines: readonly EngineRows[], rules: readonly string[]): string {
  const head = engines.map((e) => `${e.label} bad | ${e.label} clean | ${e.label}`).join(" | ");
  const lines = [`| rule | deprecated | ${head} |`];
  lines.push(`|${"---|".repeat(2 + engines.length * 3)}`);
  for (const rule of rules) {
    const rows = engines.map((e) => e.rows.find((r) => r.rule === rule));
    const flag = rows[0]?.deprecated === true ? "yes" : "";
    const cells = rows.map((r) => `${cell(r)} | ${r === undefined ? "" : MARK[r.cell]}`);
    lines.push(`| ${rule} | ${flag} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}
