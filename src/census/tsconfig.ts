import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { loadTypeScript } from "../complexity/index.ts";
import type { Ts } from "../complexity/index.ts";
import { tsconfigExcluded } from "./config.ts";
import type { ConfigHit } from "./config.ts";

export type TsconfigRead =
  | { readonly ok: true; readonly hits: readonly ConfigHit[] }
  | { readonly ok: false; readonly message: string };

/**
 * The config with its `exclude` emptied (an `exclude` in an extended config too), so the files `include` selects
 * can be listed before `exclude` takes any out. TypeScript still leaves `node_modules` out of a `**` it matches.
 */
const withoutExclude = (config: unknown): unknown => Object.assign({}, config, { exclude: [] });

const relativeTo = (cwd: string, file: string): string => relative(cwd, file);

/** The tracked files `tsconfig.json` selects, and the files its program holds (imports followed), relative to the project. */
function programOf(
  ts: Ts,
  cwd: string,
  config: unknown,
): { readonly candidates: string[]; readonly program: Set<string> } {
  const listed = ts.parseJsonConfigFileContent(withoutExclude(config), ts.sys, cwd);
  const kept = ts.parseJsonConfigFileContent(config, ts.sys, cwd);
  const built = ts.createProgram({ rootNames: kept.fileNames, options: kept.options });
  return {
    candidates: listed.fileNames.map((file) => relativeTo(cwd, file)),
    program: new Set(built.getSourceFiles().map((file) => relativeTo(cwd, file.fileName))),
  };
}

/** The hits for a config file that was read: its candidates the program does not hold, among the tracked files. */
function hitsOf(
  ts: Ts,
  cwd: string,
  config: unknown,
  tracked: ReadonlySet<string>,
): readonly ConfigHit[] {
  const { candidates, program } = programOf(ts, cwd, config);
  return tsconfigExcluded(
    candidates.filter((file) => tracked.has(file)),
    program,
  );
}

function readHits(cwd: string, path: string, tracked: ReadonlySet<string>): TsconfigRead {
  const ts = loadTypeScript(cwd);
  const read = ts.readConfigFile(path, (file) => ts.sys.readFile(file));
  if (read.error !== undefined)
    return { ok: false, message: ts.flattenDiagnosticMessageText(read.error.messageText, " ") };
  return { ok: true, hits: hitsOf(ts, cwd, read.config, tracked) };
}

/**
 * `tsconfig-exclude` (WEB_TOPS.md section 6.7): the tracked files `tsconfig.json` `include` selects that its
 * `exclude` leaves out of the program. No `tsconfig.json` is no hits. The TypeScript is the project's own.
 */
export function tsconfigHits(cwd: string, tracked: ReadonlySet<string>): TsconfigRead {
  const path = join(cwd, "tsconfig.json");
  if (!existsSync(path)) return { ok: true, hits: [] };
  try {
    return readHits(cwd, path, tracked);
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}
