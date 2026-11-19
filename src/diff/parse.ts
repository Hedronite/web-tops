import type { ChangedFile, ChangeStatus, LineRange } from "./types.ts";

interface Mutable {
  readonly path: string;
  readonly status: ChangeStatus;
  readonly ranges: LineRange[];
  readonly removedAfter: number[];
}

interface Hunk {
  oldLeft: number;
  newLeft: number;
  adds: boolean;
  removes: boolean;
}

interface State {
  readonly files: Mutable[];
  file: Mutable | undefined;
  /** The `---` path: undefined before one is read, null for /dev/null. */
  oldPath: string | null | undefined;
  hunk: Hunk | undefined;
  newLine: number;
}

const HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", t: "\t", n: "\n" };

function unquote(text: string): string {
  return text.slice(1, -1).replace(/\\(["\\tn])/g, (_, key: string) => ESCAPES[key] ?? key);
}

/** The path after `---` or `+++`: without git's trailing tab and a/ b/ prefix; null for /dev/null. */
function pathOf(raw: string): string | null {
  const text = raw.replace(/\t.*/, "");
  if (text === "/dev/null") return null;
  const bare = text.startsWith('"') ? unquote(text) : text;
  return bare.replace(/^[ab]\//, "");
}

function statusOf(oldPath: string | null | undefined, newPath: string | null): ChangeStatus {
  if (oldPath === null) return "added";
  return newPath === null ? "deleted" : "modified";
}

/**
 * The data trees of section 17: fixtures and probes break rules on purpose (a bad twin of W-34 is a focused test), so a
 * file changed under them is neither source to mutate nor a test to run, and it is not listed.
 */
const DATA_TREE = /^(?:fixtures|probes)\//;

/** Makes the file current, and lists it, unless it is in a data tree: its hunks then belong to no file. */
function register(state: State, path: string, status: ChangeStatus): void {
  state.file = DATA_TREE.test(path) ? undefined : { path, status, ranges: [], removedAfter: [] };
  if (state.file !== undefined) state.files.push(state.file);
}

function openFile(state: State, raw: string): void {
  const newPath = pathOf(raw);
  const path = newPath ?? state.oldPath;
  if (path === null || path === undefined) return;
  register(state, path, statusOf(state.oldPath, newPath));
}

function startOf(match: RegExpExecArray): number {
  const start = Number(match[2]);
  return Number(match[3] ?? 1) === 0 ? start + 1 : start;
}

function openHunk(state: State, line: string): void {
  const match = HEADER.exec(line);
  if (match === null) return;
  state.newLine = startOf(match);
  state.hunk = {
    oldLeft: Number(match[1] ?? 1),
    newLeft: Number(match[3] ?? 1),
    adds: false,
    removes: false,
  };
}

function recordsRemoval(state: State, hunk: Hunk): boolean {
  return hunk.removes && !hunk.adds && state.file?.status !== "deleted";
}

function endBlock(state: State, hunk: Hunk): void {
  if (recordsRemoval(state, hunk)) state.file?.removedAfter.push(state.newLine - 1);
  hunk.adds = false;
  hunk.removes = false;
}

function addRange(ranges: LineRange[], line: number): void {
  const last = ranges.at(-1);
  if (last !== undefined && last.end === line - 1) last.end = line;
  else ranges.push({ start: line, end: line });
}

function addLine(state: State, hunk: Hunk): void {
  hunk.adds = true;
  hunk.newLeft -= 1;
  if (state.file !== undefined) addRange(state.file.ranges, state.newLine);
  state.newLine += 1;
}

function removeLine(_state: State, hunk: Hunk): void {
  hunk.removes = true;
  hunk.oldLeft -= 1;
}

function contextLine(state: State, hunk: Hunk): void {
  endBlock(state, hunk);
  hunk.oldLeft -= 1;
  hunk.newLeft -= 1;
  state.newLine += 1;
}

function ignoreLine(): void {}

const HANDLERS: Readonly<Record<string, (state: State, hunk: Hunk) => void>> = {
  "+": addLine,
  "-": removeLine,
  " ": contextLine,
  "\\": ignoreLine,
};

const handlerFor = (line: string): ((state: State, hunk: Hunk) => void) =>
  HANDLERS[line.charAt(0)] ?? contextLine;

const hunkDone = (hunk: Hunk): boolean => hunk.oldLeft <= 0 && hunk.newLeft <= 0;

function inHunk(state: State, hunk: Hunk, line: string): void {
  handlerFor(line)(state, hunk);
  if (!hunkDone(hunk)) return;
  endBlock(state, hunk);
  state.hunk = undefined;
}

function header(state: State, line: string): void {
  if (line.startsWith("--- ")) state.oldPath = pathOf(line.slice(4));
  else if (line.startsWith("+++ ")) openFile(state, line.slice(4));
  else openHunk(state, line);
}

function feed(state: State, line: string): void {
  if (state.hunk === undefined) header(state, line);
  else inHunk(state, state.hunk, line);
}

/**
 * The files of a unified diff (`git diff -U0`, or with context): for each, the new-side lines it adds or
 * changes as inclusive ranges, and the places lines were only removed. Binary files have no hunks and are not listed.
 */
export function parseDiff(text: string): readonly ChangedFile[] {
  const state: State = {
    files: [],
    file: undefined,
    oldPath: undefined,
    hunk: undefined,
    newLine: 1,
  };
  for (const line of text.split("\n")) feed(state, line);
  return state.files;
}
