import { isNotEvaluated } from "./observe.ts";
import { provenBy, proves } from "./proofs.ts";
import type {
  Expectation,
  LawProbe,
  Observed,
  ProbeFailure,
  ProbeLaw,
  Twin,
  TwinKind,
} from "./types.ts";

/** What the judge reads of one law: its twins, the markers in them, and what the tools reported on them. */
export interface LawEvidence {
  readonly law: ProbeLaw;
  readonly twins: readonly Twin[];
  readonly marks: readonly Expectation[];
  readonly seen: readonly Observed[];
}

const at = (found: { file: string; line: number }): string => `${found.file}:${String(found.line)}`;

const explains = (law: ProbeLaw, rule: string): boolean =>
  law.proofs.some((proof) => proves(proof, rule));

function filesOf(twins: readonly Twin[], kind: TwinKind): Set<string> {
  return new Set(twins.filter((twin) => twin.kind === kind).map((twin) => twin.file));
}

const NO_TWIN = { bad: "no-bad-twin", clean: "no-clean-twin" } as const;

/** A law with no file on one side has no twin there: nothing proves its reader. */
function missingTwin(law: ProbeLaw, twins: readonly Twin[], kind: TwinKind): ProbeFailure[] {
  return filesOf(twins, kind).size > 0
    ? []
    : [{ kind: NO_TWIN[kind], message: `${law.id} has no ${kind} twin under ${law.id}/${kind}/` }];
}

/** A file that starts with `_` only supports the twins beside it (a type to import): it carries no marker, and is judged. */
const isSupport = (file: string): boolean => (file.split("/").at(-1) ?? "").startsWith("_");

/** Every bad twin carries a marker: a file with none proves nothing. */
function unmarked(bad: ReadonlySet<string>, marks: readonly Expectation[]): ProbeFailure[] {
  const marked = new Set(marks.map((mark) => mark.file));
  return [...bad]
    .filter((file) => !marked.has(file) && !isSupport(file))
    .map((file) => ({ kind: "no-marker", file, message: `${file} has no // expect: marker` }));
}

const seenAt = (seen: readonly Observed[], mark: Expectation, rule: string): boolean =>
  seen.some(
    (found) => found.file === mark.file && found.line === mark.line && proves(rule, found.rule),
  );

/** A marked rule that did not fire on its line: the reader is silent. */
function silent(marks: readonly Expectation[], seen: readonly Observed[]): ProbeFailure[] {
  return marks.flatMap((mark) =>
    mark.rules
      .filter((rule) => !seenAt(seen, mark, rule))
      .map((rule) => ({
        kind: "silent" as const,
        file: mark.file,
        line: mark.line,
        rule,
        message: `${at(mark)} stayed quiet: ${rule} did not fire on its bad twin`,
      })),
  );
}

/**
 * A twin its tool could not evaluate (it did not parse, or no config reaches it, as an Astro twin with no Astro config)
 * proves nothing either way, and a clean twin would otherwise pass for want of findings.
 */
function notEvaluated(own: ReadonlySet<string>, seen: readonly Observed[]): ProbeFailure[] {
  return seen
    .filter((found) => own.has(found.file) && isNotEvaluated(found.rule))
    .map((found) => ({
      kind: "not-evaluated",
      file: found.file,
      message: `${found.file} was not evaluated: ${found.rule} (it did not parse, or no config applies to it)`,
    }));
}

const marked = (marks: readonly Expectation[], found: Observed): boolean =>
  marks.some(
    (mark) =>
      mark.file === found.file &&
      mark.line === found.line &&
      mark.rules.some((rule) => proves(rule, found.rule)),
  );

/** A rule of the law that fired on a bad twin line that does not name it. */
function unexpected(
  law: ProbeLaw,
  bad: ReadonlySet<string>,
  marks: readonly Expectation[],
  seen: readonly Observed[],
): ProbeFailure[] {
  return seen
    .filter((found) => bad.has(found.file) && explains(law, found.rule) && !marked(marks, found))
    .map((found) => ({
      kind: "unexpected",
      ...found,
      message: `${at(found)} reports ${found.rule}, which no marker on that line names`,
    }));
}

/** A rule of the law that fired on a clean twin: the reader is noisy. */
function noisy(
  law: ProbeLaw,
  clean: ReadonlySet<string>,
  seen: readonly Observed[],
): ProbeFailure[] {
  return seen
    .filter((found) => clean.has(found.file) && explains(law, found.rule))
    .map((found) => ({
      kind: "noisy",
      ...found,
      message: `${at(found)} fired ${found.rule} on its clean twin`,
    }));
}

function marksInClean(clean: ReadonlySet<string>, marks: readonly Expectation[]): ProbeFailure[] {
  return marks
    .filter((mark) => clean.has(mark.file))
    .map((mark) => ({
      kind: "marker-in-clean",
      file: mark.file,
      line: mark.line,
      message: `${at(mark)} is a clean twin and carries an // expect: marker`,
    }));
}

/** Each thing the law maps has a marker in a bad twin, else the law claims a rule it never proves fires. */
function unproven(law: ProbeLaw, marks: readonly Expectation[]): ProbeFailure[] {
  const named = marks.flatMap((mark) => mark.rules);
  return law.proofs
    .filter((proof) => !named.some((rule) => provenBy(proof, rule)))
    .map((proof) => ({
      kind: "unproven",
      rule: proof,
      message: `${law.id} maps ${proof}, and no bad twin proves it fires`,
    }));
}

const inFiles = <T extends { file: string }>(
  items: readonly T[],
  files: ReadonlySet<string>,
): T[] => items.filter((item) => files.has(item.file));

/** Judges one law: its bad twin must fire exactly what it marks, and its clean twin must stay quiet. */
export function judgeLaw(evidence: LawEvidence): LawProbe {
  const { law, twins, seen } = evidence;
  const bad = filesOf(twins, "bad");
  const clean = filesOf(twins, "clean");
  const own = new Set([...bad, ...clean]);
  const marks = inFiles(evidence.marks, own);
  const badMarks = inFiles(marks, bad);
  const failures = [
    ...missingTwin(law, twins, "bad"),
    ...missingTwin(law, twins, "clean"),
    ...unmarked(bad, badMarks),
    ...notEvaluated(own, seen),
    ...silent(badMarks, seen),
    ...unexpected(law, bad, badMarks, seen),
    ...marksInClean(clean, marks),
    ...noisy(law, clean, seen),
    ...unproven(law, badMarks),
  ];
  const unrelated = inFiles(seen, own).filter(
    (found) => !explains(law, found.rule) && !marked(marks, found) && !isNotEvaluated(found.rule),
  );
  return { id: law.id, verdict: failures.length === 0 ? "pass" : "fail", failures, unrelated };
}
