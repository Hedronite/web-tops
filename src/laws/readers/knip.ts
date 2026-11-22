import { isRecord, parseJson, records, runTool, str } from "../../layers/hygiene/tooling.ts";
import type { LawReader, ReadInput } from "./types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { gaveAnswer, notEvaluated, readingOf, saidOf } from "./reading.ts";

/** What W-48 counts of knip's report: unused files, exports and types, and unused dependencies. */
const UNUSED: ReadonlyMap<string, string> = new Map([
  ["files", "file"],
  ["exports", "export"],
  ["types", "type"],
  ["dependencies", "dependency"],
  ["devDependencies", "devDependency"],
  ["optionalPeerDependencies", "optional peer dependency"],
]);

function itemFindings(
  file: string,
  category: string,
  label: string,
  issue: Record<string, unknown>,
): RawFinding[] {
  return records(issue[category]).map((item) => {
    const line = item["line"];
    return {
      tool: "knip",
      rule: `knip:${category}`,
      verdict: "refuse",
      message: `unused ${label} ${str(item["name"], "?")}`,
      file,
      ...(typeof line === "number" ? { line } : {}),
    };
  });
}

/** The unused items of a `knip --reporter json` report: one finding each; undefined when the text is not a report. */
export function readKnip(text: string): RawFinding[] | undefined {
  const report = parseJson(text);
  if (!isRecord(report) || !Array.isArray(report["issues"])) {
    return undefined;
  }
  return records(report["issues"]).flatMap((issue) =>
    [...UNUSED].flatMap(([category, label]) =>
      itemFindings(str(issue["file"], "?"), category, label, issue),
    ),
  );
}

type Scan = { readonly findings: RawFinding[] } | { readonly reason: string };

/** Runs knip once; exit 0 is clean and 1 lists issues, and anything else is no answer. */
export async function runKnip(input: ReadInput): Promise<Scan> {
  const result = await runTool(input.ctx, "knip", ["--reporter", "json"]);
  const found = gaveAnswer(result) ? readKnip(result.stdout) : undefined;
  if (found === undefined) {
    return { reason: `knip exited ${String(result.code)} and gave no report: ${saidOf(result)}` };
  }
  return { findings: found };
}

/** The knip reader (W-48): unused files, exports and dependencies. A break is `refuse`, which a soft law turns into `ack-missing`. */
export const knipReader: LawReader = async (input) => {
  const done = await runKnip(input);
  return input.laws.map((law) =>
    "reason" in done ? notEvaluated(law, done.reason) : readingOf(law, done.findings, false),
  );
};
