import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOG_DIR,
  LAW_CLASSES,
  explainText,
  findLaw,
  listText,
  loadCatalog,
  select,
  syncTables,
} from "../laws/catalog/index.ts";
import type { Law, LawClass } from "../laws/catalog/index.ts";
import { parseFlags } from "../survivors/flags.ts";
import type { FlagSpec, Flags } from "../survivors/flags.ts";
import type { Io } from "./io.ts";

const USAGE =
  "usage: webtops laws [list [--class <class>] [--required] [--json] | explain <W-NN> [--json] | sync [--check]]\n";

const PROTOCOL_FILE = "WEB_TOPS.md";

const failure = (io: Io, message: string): number => {
  io.err(`webtops laws: ${message}\n`);
  return 2;
};

const usageFailure = (io: Io, message: string): number =>
  failure(io, `${message}\n${USAGE.trimEnd()}`);

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Prints the value as JSON under `--json`, else the text. */
const emit = (io: Io, flags: Flags, value: unknown, text: string): number => {
  io.out(flags.switches.has("--json") ? json(value) : text);
  return 0;
};

const isClass = (name: string): name is LawClass => LAW_CLASSES.some((known) => known === name);

type Chosen =
  | { readonly ok: true; readonly value: LawClass | undefined }
  | { readonly ok: false; readonly message: string };

function classOf(name: string | undefined): Chosen {
  if (name === undefined) return { ok: true, value: undefined };
  return isClass(name)
    ? { ok: true, value: name }
    : { ok: false, message: `unknown class "${name}" (one of ${LAW_CLASSES.join(", ")})` };
}

type Handler = (flags: Flags, io: Io, laws: readonly Law[]) => number;

function list(flags: Flags, io: Io, laws: readonly Law[]): number {
  const chosen = classOf(flags.values.get("--class"));
  if (!chosen.ok) return usageFailure(io, chosen.message);
  const filter = { cls: chosen.value, required: flags.switches.has("--required") };
  const shown = select(laws, filter);
  return emit(io, flags, shown, listText(shown, laws.length, filter));
}

function explain(flags: Flags, io: Io, laws: readonly Law[]): number {
  const id = String(flags.positionals[0]);
  const law = findLaw(laws, id);
  if (law === undefined) return failure(io, `no law "${id}" in the catalog`);
  return emit(io, flags, law, explainText(law));
}

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

type Checked =
  | { readonly ok: true; readonly path: string; readonly text: string; readonly markdown: string }
  | { readonly ok: false; readonly message: string };

/** WEB_TOPS.md in the project, and what its section 8.2 should read as, from the catalog. */
function checkProtocol(io: Io, laws: readonly Law[]): Checked {
  const path = join(io.cwd, PROTOCOL_FILE);
  const text = readText(path);
  if (text === undefined)
    return { ok: false, message: `cannot read ${PROTOCOL_FILE} in ${io.cwd}` };
  const synced = syncTables(text, laws);
  return synced.ok
    ? { ok: true, path, text, markdown: synced.markdown }
    : { ok: false, message: synced.problems.join("\n") };
}

const drift = (io: Io): number => {
  io.err(`${PROTOCOL_FILE} section 8.2 differs from laws/: run webtops laws sync\n`);
  return 1;
};

const rewrite = (io: Io, path: string, markdown: string): number => {
  writeFileSync(path, markdown);
  io.out(`${PROTOCOL_FILE} section 8.2 rewritten from laws/\n`);
  return 0;
};

/** `laws sync`: section 8.2 of WEB_TOPS.md, rewritten from the catalog; `--check` reports drift and writes nothing. */
function sync(flags: Flags, io: Io, laws: readonly Law[]): number {
  const found = checkProtocol(io, laws);
  if (!found.ok) return failure(io, found.message);
  if (found.markdown === found.text) {
    io.out(`${PROTOCOL_FILE} section 8.2 matches laws/\n`);
    return 0;
  }
  return flags.switches.has("--check") ? drift(io) : rewrite(io, found.path, found.markdown);
}

interface Sub {
  readonly spec: FlagSpec;
  /** What follows the subcommand, in words, and how many words that is. */
  readonly takes: string;
  readonly words: number;
  readonly run: Handler;
}

const SUBS: ReadonlyMap<string, Sub> = new Map([
  [
    "list",
    {
      spec: { values: ["--class"], switches: ["--required", "--json"] },
      takes: "no words",
      words: 0,
      run: list,
    },
  ],
  ["explain", { spec: { switches: ["--json"] }, takes: "one law id", words: 1, run: explain }],
  ["sync", { spec: { switches: ["--check"] }, takes: "no words", words: 0, run: sync }],
]);

interface Parsed {
  readonly sub: Sub;
  readonly flags: Flags;
}

/** The subcommand and its flags, or the exit code after saying what is wrong. */
function parse(argv: readonly string[], io: Io): Parsed | number {
  const [name, ...rest] = argv;
  const sub = SUBS.get(String(name));
  if (sub === undefined) return usageFailure(io, "expected list, explain or sync");
  const flags = parseFlags(rest, sub.spec);
  if (typeof flags === "string") return usageFailure(io, flags);
  return flags.positionals.length === sub.words
    ? { sub, flags }
    : usageFailure(io, `${String(name)} takes ${sub.takes} after it`);
}

/** The kit's laws, or the exit code after listing what is wrong with the catalog. */
function lawsOf(io: Io, catalog: string): readonly Law[] | number {
  const loaded = loadCatalog(catalog);
  if (loaded.ok) return loaded.laws;
  const lines = loaded.problems.map(
    (found) => `  ${found.file}${found.pointer}: ${found.message}\n`,
  );
  return failure(io, `the catalog is invalid\n${lines.join("").trimEnd()}`);
}

/** `list`, `explain` and `sync`: the law catalog (WEB_TOPS.md section 8). */
function runCatalogCli(argv: readonly string[], io: Io, catalog: string): Promise<number> {
  const parsed = parse(argv, io);
  if (typeof parsed === "number") return Promise.resolve(parsed);
  const laws = lawsOf(io, catalog);
  if (typeof laws === "number") return Promise.resolve(laws);
  return Promise.resolve(parsed.sub.run(parsed.flags, io, laws));
}

/** `webtops laws`: the law catalog (section 8), and `probe`, which proves the readers of the laws (G3). */
export async function runLawsCli(
  argv: readonly string[],
  io: Io,
  catalog = CATALOG_DIR,
): Promise<number> {
  if (argv[0] === "probe") {
    // Loaded here, not at the top: `probe` is G3's, and this file's own module-level code is left as it was.
    const { runLawsProbeCli } = await import("./laws-probe.ts");
    return runLawsProbeCli(argv.slice(1), io);
  }
  return runCatalogCli(argv, io, catalog);
}
