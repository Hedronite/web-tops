import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { isRecord, parseJson, records, runTool } from "../../layers/hygiene/tooling.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";
import type { RawFinding } from "../../report/findings.ts";
import { gaveAnswer, notEvaluated, readingOf, saidOf } from "./reading.ts";

/** W-39 reads the scanner `secretlint` with its recommended preset (WEB_TOPS.md section 2). */
const PRESET = "@secretlint/secretlint-rule-preset-recommend";

/** The project's own rules, when it keeps them: a file named for secretlint in the project root. */
const PROJECT_CONFIG = ".secretlintrc.json";

/** Tracked files that are not text a secret can sit in, and `bun.lock`, whose integrity hashes the scanner reads as secrets and no one wrote by hand. */
export const isScannable = (file: string): boolean => {
  const binary = [
    ".avif",
    ".eot",
    ".gif",
    ".gz",
    ".ico",
    ".jpeg",
    ".jpg",
    ".mp3",
    ".mp4",
    ".otf",
    ".pdf",
    ".png",
    ".tgz",
    ".ttf",
    ".wasm",
    ".webp",
    ".woff",
    ".woff2",
    ".zip",
  ];
  return !binary.includes(extname(file).toLowerCase()) && !["bun.lock", "bun.lockb"].includes(file);
};

/** How many files one scanner run is given, so that a large project does not overrun the length of a command line. */
const BATCH = 100;

/** The config flag: none when the project keeps its own, else the preset written into the run's directory. */
export function configArgs(cwd: string, outDir: string): string[] {
  if (existsSync(join(cwd, PROJECT_CONFIG))) {
    return [];
  }
  const directory = join(outDir, "laws");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "secretlintrc.json");
  writeFileSync(path, `${JSON.stringify({ rules: [{ id: PRESET }] })}\n`);
  return ["--secretlintrc", path];
}

const batches = (files: readonly string[]): string[][] =>
  Array.from({ length: Math.ceil(files.length / BATCH) }, (_, at) =>
    files.slice(at * BATCH, (at + 1) * BATCH),
  );

function lineOf(message: Record<string, unknown>): number | undefined {
  const loc = message["loc"];
  const start = isRecord(loc) ? loc["start"] : undefined;
  const line = isRecord(start) ? start["line"] : undefined;
  return typeof line === "number" ? line : undefined;
}

function messageFinding(cwd: string, file: string, message: Record<string, unknown>): RawFinding {
  const line = lineOf(message);
  return {
    tool: "secretlint",
    rule: `secretlint:${String(message["ruleId"])}`,
    verdict: "refuse",
    message: String(message["message"]),
    file: relative(cwd, file),
    ...(line === undefined ? {} : { line }),
  };
}

/** The directory the scanner reports paths against: it prints real paths, so a project reached through a link needs its real one. */
const realBase = (cwd: string): string => (existsSync(cwd) ? realpathSync(cwd) : cwd);

/** The findings of one `secretlint --format json` run: an array of files, each with its messages; undefined for any other text. */
export function readScan(cwd: string, text: string): RawFinding[] | undefined {
  const value = parseJson(text);
  if (!Array.isArray(value)) {
    return undefined;
  }
  return records(value).flatMap((entry) =>
    records(entry["messages"]).map((message) =>
      messageFinding(cwd, String(entry["filePath"]), message),
    ),
  );
}

type Scan = { readonly findings: RawFinding[] } | { readonly reason: string };

async function scanBatch(
  input: ReadInput,
  args: readonly string[],
  files: readonly string[],
): Promise<Scan> {
  const result = await runTool(input.ctx, "secretlint", [...args, "--format", "json", ...files]);
  const found = gaveAnswer(result) ? readScan(realBase(input.ctx.cwd), result.stdout) : undefined;
  if (found === undefined) {
    return {
      reason: `secretlint exited ${String(result.code)} and gave no scan: ${saidOf(result)}`,
    };
  }
  return { findings: found };
}

/** The scan of every scannable tracked file, in batches: the findings, or why the scanner did not give an answer. */
export async function scan(input: ReadInput): Promise<Scan> {
  const args = configArgs(input.ctx.cwd, input.ctx.outDir);
  const findings: RawFinding[] = [];
  for (const files of batches(input.tracked.filter(isScannable))) {
    const done = await scanBatch(input, args, files);
    if ("reason" in done) {
      return done;
    }
    findings.push(...done.findings);
  }
  return { findings };
}

const NOTHING_TO_SCAN = "0 files scanned: no tracked file can hold a secret";

/** What the scan comes to for one law: a finding for each secret, or a pass that says nothing was scanned when nothing could be. */
function judgedScan(law: LawEntry, done: Scan, scanned: number): LawReading {
  if ("reason" in done) {
    return notEvaluated(law, done.reason);
  }
  const reading = readingOf(law, done.findings, false);
  return scanned === 0 ? { ...reading, note: NOTHING_TO_SCAN } : reading;
}

/**
 * The secrets reader (W-39): `secretlint` over the tracked files. A scanner that did not run is not evaluated. A project
 * with no file a secret can sit in runs no scanner, and its pass says "0 files scanned", so the law's line does not read
 * as a scan that found nothing.
 */
export const secretsReader: LawReader = async (input) => {
  const done = await scan(input);
  const scanned = input.tracked.filter(isScannable).length;
  return input.laws.map((law) => judgedScan(law, done, scanned));
};
