import { readFileSync } from "node:fs";
import { validateReport } from "../config/report.ts";
import type { Problem } from "../config/types.ts";
import type { Report } from "./types.ts";
import { formatText } from "./text.ts";

export type ReportFormat = "text" | "json";

/** The stored report as text (the one printer `gate` also uses) or as indented JSON. */
export function renderReport(report: Report, format: ReportFormat): string {
  return format === "json" ? `${JSON.stringify(report, null, 2)}\n` : formatText(report);
}

export type ReportLoad =
  { readonly ok: true; readonly report: Report } | { readonly ok: false; readonly error: string };

type Step<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function readText(path: string): Step<string> {
  try {
    const text = readFileSync(path, "utf8");
    return text.trim() === ""
      ? { ok: false, error: `${path} is empty` }
      : { ok: true, value: text };
  } catch {
    return { ok: false, error: `no report at ${path}; run \`webtops gate\` first` };
  }
}

function parseJson(path: string, text: string): Step<unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, error: `${path} is not valid JSON` };
  }
}

const pointerLine = (problem: Problem): string =>
  `\n  ${problem.pointer === "" ? "(document)" : problem.pointer}: ${problem.message}`;

/** Reads and validates a report file: a missing, empty or invalid report is an error, never an empty rendering. */
export function loadReport(path: string): ReportLoad {
  const text = readText(path);
  if (!text.ok) return text;
  const json = parseJson(path, text.value);
  if (!json.ok) return json;
  const checked = validateReport(json.value);
  if (checked.ok) return { ok: true, report: checked.value };
  const lines = checked.problems.map(pointerLine).join("");
  return { ok: false, error: `${path} does not match schema/gate-report.schema.json:${lines}` };
}
