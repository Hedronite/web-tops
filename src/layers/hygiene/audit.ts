import { writeFileSync } from "node:fs";
import type { Finding } from "../../report/types.ts";
import type { AuditLevel, ExecResult } from "../../gate/types.ts";
import {
  capFindings,
  isRecord,
  ran,
  readJsonOutput,
  records,
  failFinding,
  shapeFinding,
  str,
  tail,
  type StepContext,
  type StepResult,
} from "./tooling.ts";

/** Gate 1, step `audit`: `bun audit --prod --json`, mapped by severity (observed on Bun 1.4.4). */

const RANK: Readonly<Record<string, number>> = { low: 1, moderate: 2, high: 3, critical: 4 };

function rankOf(level: string): number {
  return RANK[level] ?? 0;
}

/** Output that says the advisory registry could not be reached, as opposed to a clean or vulnerable result. */
const UNREACHABLE =
  /(ConnectionRefused|ENOTFOUND|ECONNRESET|ETIMEDOUT|timed out|fetch failed|POST https?:|GET https?:)/iu;

function advisoryId(url: unknown, fallback: unknown): string {
  if (typeof url === "string") {
    return url.split("/").pop() ?? url;
  }
  return typeof fallback === "number" ? String(fallback) : "advisory";
}

/** Nothing on stdout: the registry was not reached (not evaluated), or bun printed nothing at all. */
function silentAudit(result: ExecResult): Finding | undefined {
  if (result.stdout.trim() !== "") {
    return undefined;
  }
  if (UNREACHABLE.test(result.stderr)) {
    return {
      rule: "audit-unreachable",
      verdict: "not-evaluated",
      message: `the advisory registry could not be reached: ${tail(result.stderr, 2)}`,
    };
  }
  return failFinding(
    "output-empty",
    `bun audit exited ${String(result.code)} and printed nothing: ${tail(result.stderr)}`,
  );
}

function readAudit(
  step: StepContext,
  path: string,
  stdout: string,
): { readonly report: Record<string, unknown> } | { readonly finding: Finding } {
  const parsed = readJsonOutput(step, path, stdout, "bun audit");
  if ("finding" in parsed) {
    return parsed;
  }
  return isRecord(parsed.value)
    ? { report: parsed.value }
    : { finding: shapeFinding(step, path, "bun audit JSON is not an object keyed by package") };
}

function advisoryFinding(
  name: string,
  advisory: Record<string, unknown>,
  failOn: AuditLevel,
): Finding[] {
  const severity = advisory["severity"];
  if (typeof severity !== "string" || rankOf(severity) < rankOf(failOn)) {
    return [];
  }
  const title = str(advisory["title"], "advisory");
  return [
    failFinding(advisoryId(advisory["url"], advisory["id"]), `${name}: ${title} (${severity})`),
  ];
}

function advisoryFindings(report: Record<string, unknown>, failOn: AuditLevel): Finding[] {
  return Object.entries(report).flatMap(([name, advisories]) =>
    records(advisories).flatMap((advisory) => advisoryFinding(name, advisory, failOn)),
  );
}

export async function audit(step: StepContext): Promise<StepResult> {
  const path = step.out("audit.json");
  const outcome = await ran(step, "bun", ["audit", "--prod", "--json"], "bun audit");
  if ("failed" in outcome) {
    return outcome.failed;
  }
  const { result } = outcome;
  const silent = silentAudit(result);
  if (silent !== undefined) {
    return { findings: [silent] };
  }
  writeFileSync(path, result.stdout);
  const read = readAudit(step, path, result.stdout);
  if ("finding" in read) {
    return { findings: [read.finding] };
  }
  const findings = advisoryFindings(read.report, step.settings.auditFailOn);
  return { findings: capFindings(findings, "audit"), artifacts: { "audit-json": path } };
}
