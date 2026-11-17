import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Report } from "./types.ts";

/** Writes the report as JSON with a trailing newline, creating its directory (WEB_TOPS.md section 6.6). */
export function writeReport(path: string, report: Report): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}
