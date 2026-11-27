import { isRecord, parseJson, readOutput } from "../../layers/hygiene/tooling.ts";
import type { RawFinding } from "../../report/findings.ts";
import { notEvaluated, readingOf } from "./reading.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";

interface BytesSpec {
  readonly artifact: "bytes-json" | "route-bytes-json";
  readonly listKey: "pages" | "routes";
  readonly rule: "page-js-bytes" | "route-js-bytes";
}

/** An entry the byte layer judged: an object with a verdict of its own. */
const isJudged = (entry: unknown): entry is Record<string, unknown> =>
  isRecord(entry) && typeof entry["passed"] === "boolean";

/** Every entry of the report, or none: one that was not judged leaves the report unread, never passed over. */
function readEntries(
  text: string | undefined,
  key: "pages" | "routes",
): Record<string, unknown>[] | undefined {
  const parsed = parseJson(text);
  const list: unknown = isRecord(parsed) ? parsed[key] : undefined;
  return Array.isArray(list) && list.every(isJudged) ? list : undefined;
}

const numStr = (value: unknown): string => (typeof value === "number" ? String(value) : "?");
const routeOf = (entry: Record<string, unknown>): string =>
  typeof entry["route"] === "string" ? entry["route"] : "/";
const fileField = (value: unknown): { readonly file?: string } =>
  typeof value === "string" && value !== "" ? { file: value } : {};

function toFinding(entry: Record<string, unknown>, rule: string): RawFinding | undefined {
  if (entry["passed"] !== false) return undefined;
  const total = numStr(entry["totalBytes"]);
  const budget = numStr(entry["budgetBytes"]);
  return {
    tool: "webtops",
    rule,
    verdict: "refuse",
    message: `${routeOf(entry)}: ${total} B exceeds JS budget ${budget} B`,
    ...fileField(entry["file"]),
  };
}

function judgeLaw(
  entries: readonly Record<string, unknown>[],
  spec: BytesSpec,
  law: LawEntry,
): LawReading {
  if (entries.length === 0) {
    return notEvaluated(law, `no ${spec.listKey} were evaluated in ${spec.artifact}`);
  }
  const breaks = entries.flatMap((entry) => {
    const finding = toFinding(entry, spec.rule);
    return finding === undefined ? [] : [finding];
  });
  return readingOf(law, breaks, false);
}

function makeBytesReader(spec: BytesSpec): LawReader {
  const missing = `the ${spec.artifact} artifact of gate 6 is missing or is not a report of judged entries`;
  return (input: ReadInput): Promise<readonly LawReading[]> => {
    const path = input.ctx.artifacts.get(spec.artifact);
    const entries = path === undefined ? undefined : readEntries(readOutput(path), spec.listKey);
    return Promise.resolve(
      input.laws.map((law) =>
        entries === undefined ? notEvaluated(law, missing) : judgeLaw(entries, spec, law),
      ),
    );
  };
}

/** Built-page JS byte budget reader (W-29 on `astro-site`), reading `bytes-json`. */
export const bytesReader: LawReader = makeBytesReader({
  artifact: "bytes-json",
  listKey: "pages",
  rule: "page-js-bytes",
});

/** Route JS byte budget reader (W-29 on `web-app`), reading `route-bytes-json`. */
export const routeBytesReader: LawReader = makeBytesReader({
  artifact: "route-bytes-json",
  listKey: "routes",
  rule: "route-js-bytes",
});
