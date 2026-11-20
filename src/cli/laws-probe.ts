import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { realExec } from "../gate/exec.ts";
import type { Exec } from "../gate/types.ts";
import { CatalogError, catalogLaws, lawsOfClass } from "../laws/probe/catalog.ts";
import { probeExit, probeText } from "../laws/probe/format.ts";
import { runProbe, type ProbeOutcome, type ProbeRequest } from "../laws/probe/run.ts";
import type { LawSource, ProbeLaw, ProbeReport } from "../laws/probe/types.ts";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { isRecord } from "../layers/hygiene/tooling.ts";
import type { Io } from "./io.ts";

function usage(): string {
  return "usage: webtops laws probe [--law W-NN] [--class <class>] [--fixtures <dir>] [--config <eslint config>] [--tsconfig <file>] [--json]\n";
}

/** The twins the kit ships, beside `src/`. */
/** The class of a project with no `web-tops.yaml` (WEB_TOPS.md section 5.1). */
function defaultClass(): string {
  return "ts-library";
}

function shippedFixtures(): string {
  return fileURLToPath(new URL("../../fixtures/laws", import.meta.url));
}

/** What a run reads that a test replaces: how a tool runs, and where the laws come from. */
export interface ProbeDeps {
  readonly exec: Exec;
  /** Proves the laws: the probe itself, which a test of the command replaces with one that is given. */
  readonly probe: (request: ProbeRequest) => Promise<ProbeOutcome>;
  readonly laws: LawSource;
  readonly fixtures: string;
}

/** What a run reads that a test replaces, as the command has it: the gate's own exec, the catalog, the shipped twins. */
export function defaults(): ProbeDeps {
  return { exec: realExec, probe: runProbe, laws: catalogLaws, fixtures: shippedFixtures() };
}

interface Flags {
  readonly law?: string | undefined;
  readonly class?: string | undefined;
  readonly fixtures?: string | undefined;
  readonly config?: string | undefined;
  readonly tsconfig?: string | undefined;
  readonly json: boolean;
}

type Parsed = { readonly flags: Flags } | { readonly error: string };

function parseFlags(argv: readonly string[]): Parsed {
  try {
    const { values } = parseArgs({
      args: [...argv],
      allowPositionals: false,
      options: {
        law: { type: "string" },
        class: { type: "string" },
        fixtures: { type: "string" },
        config: { type: "string" },
        tsconfig: { type: "string" },
        json: { type: "boolean" },
      },
    });
    return { flags: { ...values, json: values.json === true } };
  } catch (error) {
    return { error: String(error) };
  }
}

const fail = (io: Io, message: string, code: number): number => {
  io.err(`webtops laws probe: ${message}\n`);
  return code;
};

/** The project's `web-tops.yaml` as plain data, or undefined when it has none or cannot be read. */
function projectDoc(cwd: string): unknown {
  try {
    return parse(readFileSync(join(cwd, "web-tops.yaml"), "utf8"));
  } catch {
    return undefined;
  }
}

const step = (node: unknown, key: string): unknown => (isRecord(node) ? node[key] : undefined);

/** A string `web-tops.yaml` holds at a key path, when the project has one. */
function projectString(cwd: string, ...path: readonly string[]): string | undefined {
  const named = path.reduce(step, projectDoc(cwd));
  return typeof named === "string" ? named : undefined;
}

/** The ESLint config `web-tops.yaml` names in `gates.hygiene.eslint.config`, resolved from the project. */
function projectEslintConfig(cwd: string): string | undefined {
  const named = projectString(cwd, "gates", "hygiene", "eslint", "config");
  return named === undefined ? undefined : resolve(cwd, named);
}

const absolute = (cwd: string, path: string): string =>
  isAbsolute(path) ? path : resolve(cwd, path);

const noLaws = (law: string | undefined): string =>
  law === undefined ? "no law to probe" : `no law ${law} to probe`;

/** The project's class: `--class`, else `web-tops.yaml`, else `ts-library`. */
const classOf = (io: Io, flags: Flags): string =>
  flags.class ?? projectString(io.cwd, "class") ?? defaultClass();

/** The one law asked for, or the laws the project's class maps. */
function lawsFor(io: Io, deps: ProbeDeps, flags: Flags): ProbeLaw[] {
  const laws = deps.laws();
  if (flags.law !== undefined) {
    return laws.filter((law) => law.id === flags.law);
  }
  return lawsOfClass(laws, classOf(io, flags));
}

/** Whether the project's `package.json` lists `astro` among its dependencies. */
function dependsOnAstro(cwd: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    return ["dependencies", "devDependencies", "peerDependencies"].some((field) => {
      const group = step(manifest, field);
      return isRecord(group) && "astro" in group;
    });
  } catch {
    return false;
  }
}

/**
 * Why `.astro` twins are left out, or undefined when the class's preset lints them: an astro-site always does, a
 * web-app only when the project depends on astro, and every other class has no Astro files to lint.
 */
function astroSkip(io: Io, flags: Flags): string | undefined {
  const className = classOf(io, flags);
  if (className === "astro-site") {
    return undefined;
  }
  if (className === "web-app") {
    return dependsOnAstro(io.cwd)
      ? undefined
      : "a web-app lints .astro files only when the project depends on astro";
  }
  return `the ${className} preset does not lint .astro files`;
}

/** The laws to probe, or what is wrong: the catalog cannot be read, or the flags choose no law. */
function chosen(io: Io, deps: ProbeDeps, flags: Flags): ProbeLaw[] | string {
  try {
    const laws = lawsFor(io, deps, flags);
    return laws.length === 0 ? noLaws(flags.law) : laws;
  } catch (error) {
    if (error instanceof CatalogError) {
      return error.message;
    }
    throw error;
  }
}

/** What to probe and where: the flags over the project's own files. */
function requestOf(io: Io, deps: ProbeDeps, flags: Flags, laws: readonly ProbeLaw[]): ProbeRequest {
  return {
    cwd: io.cwd,
    env: io.env,
    exec: deps.exec,
    fixtures: absolute(io.cwd, flags.fixtures ?? deps.fixtures),
    scratch: join(io.cwd, ".web-tops", "out", "laws-probe"),
    laws,
    eslintConfig:
      flags.config === undefined ? projectEslintConfig(io.cwd) : absolute(io.cwd, flags.config),
    tsconfig: absolute(io.cwd, flags.tsconfig ?? "tsconfig.json"),
    astroSkip: astroSkip(io, flags),
  };
}

function print(io: Io, report: ProbeReport, json: boolean): number {
  io.out(json ? `${JSON.stringify(report, null, 2)}\n` : probeText(report));
  return probeExit(report);
}

const finish = (io: Io, json: boolean, outcome: ProbeOutcome): number =>
  outcome.ok ? print(io, outcome.report, json) : fail(io, outcome.problem, outcome.code);

/**
 * `webtops laws probe`: proves the readers of the laws that a lint rule or a compiler flag judges. It runs the bad and
 * clean twins under this project's own ESLint config and tsconfig, so an adopter's config is proven the way the kit's is.
 * Exit 0 when every law's reader fires on its bad twin and stays quiet on its clean one, 1 when one does not, 2 for a
 * usage or config problem, 3 when a tool is missing.
 */
export async function runLawsProbeCli(
  argv: readonly string[],
  io: Io,
  deps: ProbeDeps = defaults(),
): Promise<number> {
  const parsed = parseFlags(argv);
  if ("error" in parsed) {
    return fail(io, `${parsed.error}\n${usage().trimEnd()}`, 2);
  }
  const laws = chosen(io, deps, parsed.flags);
  if (typeof laws === "string") {
    return fail(io, laws, 2);
  }
  return finish(io, parsed.flags.json, await deps.probe(requestOf(io, deps, parsed.flags, laws)));
}
