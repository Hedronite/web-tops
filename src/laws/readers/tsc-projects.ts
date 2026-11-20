import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadTypeScript } from "../../complexity/index.ts";
import type { Ts } from "../../complexity/index.ts";
import type { Spot } from "./config-lines.ts";
import type { Project } from "./tsc-judge.ts";

export type ProjectsRead =
  | { readonly ok: true; readonly projects: readonly Project[] }
  | { readonly ok: false; readonly message: string };

/** TypeScript's "No inputs were found": a solution config that only references other projects has none. */
const NO_INPUTS = 18003;

type JsonSource = ReturnType<Ts["readJsonConfigFile"]>;
type Options = ReturnType<Ts["parseJsonSourceFileConfigFileContent"]>["options"];
type JsonObject = ReturnType<Ts["factory"]["createObjectLiteralExpression"]>;
type Property = ReturnType<Ts["factory"]["createPropertyAssignment"]>;

/** A property of a config file: the line it is on, and the boolean it is set to, when it is one. */
interface Setting {
  readonly line: number;
  /** The literal as the file writes it: `true`, `false`, a quoted string. */
  readonly value: string;
}

function rootObject(ts: Ts, source: JsonSource): JsonObject | undefined {
  const expression = source.statements[0]?.expression;
  return expression !== undefined && ts.isObjectLiteralExpression(expression)
    ? expression
    : undefined;
}

function nameOf(ts: Ts, property: Property): string | undefined {
  const name = property.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

const propertiesOf = (ts: Ts, object: JsonObject | undefined): Property[] =>
  object === undefined ? [] : object.properties.filter(ts.isPropertyAssignment);

/** The object a property holds: `compilerOptions` under the root. */
function objectOf(ts: Ts, object: JsonObject | undefined, name: string): JsonObject | undefined {
  const found = propertiesOf(ts, object).find((property) => nameOf(ts, property) === name);
  const value = found?.initializer;
  return value !== undefined && ts.isObjectLiteralExpression(value) ? value : undefined;
}

const lineOf = (source: JsonSource, node: { getStart: (file: JsonSource) => number }): number =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

/** The `compilerOptions` settings of one config file, by flag. */
function settingsOf(ts: Ts, source: JsonSource): Map<string, Setting> {
  const options = objectOf(ts, rootObject(ts, source), "compilerOptions");
  const entries = propertiesOf(ts, options).flatMap((property): [string, Setting][] => {
    const name = nameOf(ts, property);
    return name === undefined
      ? []
      : [[name, { line: lineOf(source, property), value: property.initializer.getText(source) }]];
  });
  return new Map(entries);
}

/** The line `compilerOptions` starts on in a config, or the top of the file. */
function sectionLine(ts: Ts, source: JsonSource): number {
  const options = propertiesOf(ts, rootObject(ts, source)).find(
    (property) => nameOf(ts, property) === "compilerOptions",
  );
  return options === undefined ? 1 : lineOf(source, options);
}

interface Parsed {
  readonly source: JsonSource;
  readonly options: Options;
  readonly fileNames: readonly string[];
  readonly references: readonly string[];
  readonly extended: readonly string[];
  readonly errors: readonly string[];
}

function parse(ts: Ts, path: string): Parsed {
  const source = ts.readJsonConfigFile(path, (file) => ts.sys.readFile(file));
  const parsed = ts.parseJsonSourceFileConfigFileContent(
    source,
    ts.sys,
    dirname(path),
    undefined,
    path,
  );
  return {
    source,
    options: parsed.options,
    fileNames: parsed.fileNames,
    references: (parsed.projectReferences ?? []).map((reference) =>
      ts.resolveProjectReferencePath(reference),
    ),
    extended: source.extendedSourceFiles ?? [],
    errors: parsed.errors
      .filter((error) => error.code !== NO_INPUTS)
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, ts.sys.newLine)),
  };
}

interface Link {
  readonly file: string;
  readonly settings: ReadonlyMap<string, Setting>;
}

/** The nearest file of the chain whose literal is the value the chain resolves the flag to, and the line it is on. */
function ownerOf(chain: readonly Link[], flag: string, resolved: unknown): Spot | undefined {
  const owner = chain.find((link) => link.settings.get(flag)?.value === String(resolved));
  const setting = owner?.settings.get(flag);
  return owner === undefined || setting === undefined
    ? undefined
    : { file: owner.file, line: setting.line };
}

/** Where each flag is set, through the chain from the project's own config to the base it extends. */
function spotsOf(ts: Ts, cwd: string, found: Parsed, path: string): Map<string, Spot> {
  const chain = [path, ...found.extended].map((file): Link => ({
    file: relative(cwd, file),
    settings: settingsOf(
      ts,
      ts.readJsonConfigFile(file, (name) => ts.sys.readFile(name)),
    ),
  }));
  const spots = Object.entries(found.options).flatMap(([flag, resolved]): [string, Spot][] => {
    const spot = ownerOf(chain, flag, resolved);
    return spot === undefined ? [] : [[flag, spot]];
  });
  return new Map(spots);
}

/** The files of the project's program that are the project's own, relative to the root: not the library, not node_modules. */
function programOf(ts: Ts, cwd: string, found: Parsed): Set<string> {
  const program = ts.createProgram({ rootNames: [...found.fileNames], options: found.options });
  const own = program
    .getSourceFiles()
    .filter((file) => !file.fileName.split("/").includes("node_modules"))
    .map((file) => relative(cwd, file.fileName))
    .filter((file) => !file.startsWith(".."));
  return new Set(own);
}

function projectOf(ts: Ts, cwd: string, path: string, found: Parsed): Project {
  return {
    config: relative(cwd, path),
    options: found.options,
    spots: spotsOf(ts, cwd, found, path),
    section: { file: relative(cwd, path), line: sectionLine(ts, found.source) },
    files: found.fileNames.length,
    program: programOf(ts, cwd, found),
  };
}

/** Each project reached from the config through `references`, once, the config first. */
function walk(
  ts: Ts,
  cwd: string,
  path: string,
  seen: Set<string>,
  out: Project[],
): string | undefined {
  if (seen.has(path)) {
    return undefined;
  }
  seen.add(path);
  const found = parse(ts, path);
  if (found.errors.length > 0) {
    return `${relative(cwd, path)}: ${found.errors.join("; ")}`;
  }
  out.push(projectOf(ts, cwd, path, found));
  return found.references
    .map((reference) => walk(ts, cwd, reference, seen, out))
    .find((message) => message !== undefined);
}

function loadProjects(cwd: string, root: string): ProjectsRead {
  const projects: Project[] = [];
  const message = walk(loadTypeScript(cwd), cwd, root, new Set(), projects);
  return message === undefined ? { ok: true, projects } : { ok: false, message };
}

/**
 * The tsconfig projects the gate checks: `tsconfig.json` and every project it references, each read through its
 * `extends` chain with the project's own TypeScript (section 8.2, W-04).
 */
export function readProjects(cwd: string): ProjectsRead {
  const root = join(cwd, "tsconfig.json");
  if (!existsSync(root)) {
    return { ok: false, message: "tsconfig.json is missing: no compiler flag is set" };
  }
  try {
    return loadProjects(cwd, root);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
