import { isAbsolute, relative, resolve, sep } from "node:path";
import { isRecord } from "../../layers/hygiene/tooling.ts";
import type { Observed } from "./types.ts";

/** What a tool wrote about the twins, read into findings: `undefined` when it is not the shape the tool writes. */
export type Reading = readonly Observed[] | undefined;

/** A path under `root`, with `/` separators: how a twin file is named everywhere. */
export function underRoot(root: string, path: string): string {
  return relative(root, isAbsolute(path) ? path : resolve(root, path))
    .split(sep)
    .join("/");
}

/** ESLint's own words for a message with no rule: a directive nobody needs, or a file it could not read. */
function ruleOf(message: Record<string, unknown>): string {
  if (typeof message["ruleId"] === "string") {
    return message["ruleId"];
  }
  const text = message["message"];
  return typeof text === "string" && text.startsWith("Unused eslint-disable directive")
    ? "unused-disable-directive"
    : "eslint-fatal";
}

function messageFinding(root: string, file: unknown, message: Record<string, unknown>): Observed {
  return {
    file: underRoot(root, String(file)),
    line: typeof message["line"] === "number" ? message["line"] : 0,
    rule: ruleOf(message),
  };
}

/** The findings in ESLint's JSON formatter output (`[{ filePath, messages: [{ ruleId, line, message }] }]`). */
export function readEslint(root: string, json: unknown): Reading {
  if (!Array.isArray(json)) {
    return undefined;
  }
  return json
    .filter(isRecord)
    .flatMap((entry) =>
      (Array.isArray(entry["messages"]) ? entry["messages"] : [])
        .filter(isRecord)
        .map((message) => messageFinding(root, entry["filePath"], message)),
    );
}

/** `src/a.ts(3,19): error TS7006: ...` as `tsc --pretty false` prints it. */
const DIAGNOSTIC = /^(.+?)\((\d+),\d+\): error (TS\d+):/u;

/** A diagnostic with no file, such as a config error: the run cannot be trusted to have read the twins. */
const FILELESS = /^error TS\d+:/mu;

const group = (match: RegExpExecArray, index: number): string => match[index] ?? "";

function diagnosticOf(root: string, cwd: string, line: string): Observed[] {
  const found = DIAGNOSTIC.exec(line);
  return found === null
    ? []
    : [
        {
          file: underRoot(root, resolve(cwd, group(found, 1))),
          line: Number(group(found, 2)),
          rule: group(found, 3),
        },
      ];
}

/** The diagnostics of `tsc --pretty false` that name a file, or undefined when one does not (a config error). */
export function readTsc(root: string, cwd: string, text: string): Reading {
  return FILELESS.test(text)
    ? undefined
    : text.split("\n").flatMap((line) => diagnosticOf(root, cwd, line));
}
