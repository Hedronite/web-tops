import type { RawFinding } from "../../report/findings.ts";
import type { LawEntry, LawReading } from "./types.ts";
import type { Spot } from "./config-lines.ts";
import { isData } from "./files.ts";
import { codesOf } from "./tsc-diagnostics.ts";

/** One tsconfig project the gate checks, read through its `extends` chain (section 8.2, W-04). */
export interface Project {
  /** The project's tsconfig, relative to the project root. */
  readonly config: string;
  /** The resolved `compilerOptions`: what the chain sets, with no default filled in. */
  readonly options: Readonly<Record<string, unknown>>;
  /** Where each flag is set: the nearest file of the chain that sets it. */
  readonly spots: ReadonlyMap<string, Spot>;
  /** Where `compilerOptions` starts in the project's own config: the place for a flag that is absent. */
  readonly section: Spot;
  /** The files the project selects. A solution config that only references others has none, and sets no flag. */
  readonly files: number;
  /** Every file of the project's program, relative to the project root. */
  readonly program: ReadonlySet<string>;
}

export interface Facts {
  readonly projects: readonly Project[];
  /** The tracked files that are TypeScript source. */
  readonly source: readonly string[];
  /** Gate 1's compiler diagnostics, counted by code. */
  readonly diagnostics: ReadonlyMap<string, number>;
  /** The ratchet holds finding counts: they are the ratchet's to refuse (section 6.7). */
  readonly held: boolean;
}

/** The members `strict: true` turns on (the TypeScript handbook's list); `strict` is judged through them. */
export function strictFamily(): readonly string[] {
  return [
    "noImplicitAny",
    "strictNullChecks",
    "strictFunctionTypes",
    "strictBindCallApply",
    "strictPropertyInitialization",
    "noImplicitThis",
    "useUnknownInCatchVariables",
    "alwaysStrict",
    "strictBuiltinIteratorReturn",
  ];
}

/** A flag's resolved value: what the chain sets, and for a member of the family what `strict` gives it. */
export function effective(project: Project, flag: string): boolean {
  const own = project.options[flag];
  if (typeof own === "boolean") {
    return own;
  }
  return strictFamily().includes(flag) && project.options["strict"] === true;
}

const isCompilerFlag = (rule: { readonly tool: string }): boolean => rule.tool === "tsc";

const refusal = (law: string, project: Project, spot: Spot, message: string): RawFinding => ({
  tool: "tsc",
  rule: "compilerOptions",
  law,
  verdict: "refuse",
  message: `${message} (${project.config})`,
  file: spot.file,
  line: spot.line,
});

/** Where a flag is set; a member of the family left unset is where `strict` is; else the top of `compilerOptions`. */
const spotOf = (project: Project, flag: string): Spot =>
  project.spots.get(flag) ??
  (strictFamily().includes(flag) ? project.spots.get("strict") : undefined) ??
  project.section;

function flagRefusal(law: string, project: Project, flag: string): RawFinding[] {
  if (effective(project, flag)) {
    return [];
  }
  const how = project.options[flag] === false ? "is false" : "is not set";
  return [refusal(law, project, spotOf(project, flag), `${flag} ${how}`)];
}

/** `strict` must be on, and no member of the family may be off beside it: `strict: true` does not override one set to false. */
function strictRefusals(law: string, project: Project): RawFinding[] {
  if (project.options["strict"] !== true) {
    return flagRefusal(law, project, "strict");
  }
  return strictFamily().flatMap((member) => flagRefusal(law, project, member));
}

const refusalsOf = (law: string, project: Project, flag: string): RawFinding[] =>
  flag === "strict" ? strictRefusals(law, project) : flagRefusal(law, project, flag);

/** The projects that select files: only they have flags to judge. */
const checked = (facts: Facts): Project[] => facts.projects.filter((project) => project.files > 0);

/** The tracked source in no checked project's program, outside the data trees. */
export function orphans(facts: Facts): string[] {
  const held = new Set(facts.projects.flatMap((project) => [...project.program]));
  return facts.source.filter((file) => !held.has(file) && !isData(file));
}

const orphanFinding = (law: string, file: string): RawFinding => ({
  tool: "tsc",
  rule: "file-set",
  law,
  verdict: "refuse",
  message: `${file} is in no tsconfig project the gate checks, so the compiler flags never apply to it`,
  file,
});

/** The file-set law: a source file no checked project holds is judged by no flag. */
const orphanFindings = (law: string, facts: Facts): RawFinding[] =>
  orphans(facts).map((file) => orphanFinding(law, file));

const ownsStrict = (law: LawEntry): boolean => law.rules.some((rule) => rule.name === "strict");

function flagsOf(law: LawEntry): string[] {
  return law.rules
    .filter(isCompilerFlag)
    .flatMap((rule) => (rule.name === "strict" ? strictFamily() : [rule.name]));
}

function findingsOf(facts: Facts, law: LawEntry, projects: readonly Project[]): RawFinding[] {
  const flags = law.rules.filter(isCompilerFlag).map((rule) => rule.name);
  const own = projects.flatMap((project) =>
    flags.flatMap((flag) => refusalsOf(law.id, project, flag)),
  );
  return ownsStrict(law) ? [...own, ...orphanFindings(law.id, facts)] : own;
}

/** The compiler diagnostics of gate 1 that a flag of the law raises, as `TS7006 2`: a live flag a file breaks. */
export function seenOf(facts: Facts, law: LawEntry): string[] {
  const codes = [...new Set(flagsOf(law).flatMap(codesOf))].sort();
  return codes.flatMap((code) => {
    const count = facts.diagnostics.get(code) ?? 0;
    return count === 0 ? [] : [`${code} ${String(count)}`];
  });
}

const noteOf = (seen: readonly string[], held: boolean): { note?: string } =>
  seen.length === 0 ? {} : { note: `${seen.join(", ")}${held ? " held by the baseline" : ""}` };

function noProject(): string {
  return "no tsconfig project selects a file";
}

/** `refuse` for a flag that is not set or a file no project holds, and for a diagnostic of a live flag unless the ratchet holds it. */
function verdictOf(
  findings: readonly RawFinding[],
  seen: readonly string[],
  held: boolean,
): "pass" | "refuse" {
  return findings.length > 0 || (seen.length > 0 && !held) ? "refuse" : "pass";
}

/**
 * The reading of a law over its compiler flags in every checked project, the diagnostics gate 1's compile raised for
 * them, and for the strict law the tracked files no project holds.
 */
export function readLaw(facts: Facts, law: LawEntry): LawReading {
  const projects = checked(facts);
  const findings = findingsOf(facts, law, projects);
  if (projects.length === 0) {
    return { law: law.id, verdict: "not-evaluated", reason: noProject(), findings };
  }
  const seen = seenOf(facts, law);
  return {
    law: law.id,
    verdict: verdictOf(findings, seen, facts.held),
    findings,
    ...noteOf(seen, facts.held),
  };
}
