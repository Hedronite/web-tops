import { collectAcks } from "../../acks/collect.ts";
import type { Collected } from "../../acks/collect.ts";
import { ledgerOf } from "../../acks/files.ts";
import { severityOf } from "../../acks/severity.ts";
import type { SeverityOf } from "../../acks/severity.ts";
import { ratchetHeld } from "../../baseline/state.ts";
import { readProject } from "../../config/project.ts";
import type { EslintRead } from "../../census/eslint.ts";
import type { Layer, LayerContext, LayerResult } from "../../gate/types.ts";
import { askEslint } from "../../laws/readers/eslint-facts.ts";
import { askedOf, trackedLinted, unlinted } from "../../laws/readers/files.ts";
import type { RawFinding } from "../../report/findings.ts";
import type { Verdict } from "../../report/types.ts";
import { trackedFiles } from "../../layers/coverage/tracked.ts";
import { utcDate } from "../../survivors/dates.ts";
import { ackAll, lawAckFindings } from "./acked.ts";
import { forClass, lawsOfProject, toolsOf } from "./entries.ts";
import type { LawCatalog } from "./catalog.ts";
import { evidenceOf, judgeEntry, lawFinding, readingsOf, worse, type Judged } from "./judge.ts";
import { optionalArtifacts, defaultReaders, artifactOf } from "./readers.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "../../laws/readers/types.ts";

/** The laws layer (WEB_TOPS.md sections 3.1 and 6.5): it reads what gate 1 wrote, and runs no lint a second time. */

function classes(): readonly string[] {
  return ["ts-library", "ui-components", "astro-site", "web-app", "node-service"];
}

/** The ESLint question is asked once, the first time a reader needs it. */
function once(ask: () => Promise<EslintRead>): () => Promise<EslintRead> {
  let pending: Promise<EslintRead> | undefined;
  return () => {
    pending ??= ask();
    return pending;
  };
}

/** A law whose tool artifact gate 1 did not write: not evaluated, and the reason names the artifact. */
const absent = (law: LawEntry, artifact: string, tool: string): LawReading => ({
  law: law.id,
  verdict: "not-evaluated",
  reason: `${artifact} is missing: gate 1 did not write it, so ${tool} cannot be read`,
  findings: [],
});

/** The artifact of the law's rules of this tool that gate 1 did not write, if any. */
function missingOf(
  law: LawEntry,
  tool: string,
  have: ReadonlyMap<string, string>,
): string | undefined {
  return law.rules
    .filter((rule) => rule.tool === tool)
    .map(artifactOf)
    .find((artifact) => artifact !== undefined && !have.has(artifact));
}

/**
 * One reader's readings for the laws that map its tool; a tool no law maps is not asked, and a law whose artifact is
 * missing is not read at all.
 */
async function readTool(
  reader: LawReader,
  tool: string,
  laws: readonly LawEntry[],
  input: Omit<ReadInput, "laws">,
): Promise<readonly LawReading[]> {
  const mine = laws.filter((law) => toolsOf(law).includes(tool));
  const gone = new Map(
    mine.map((law) => [law, missingOf(law, tool, input.ctx.artifacts)] as const),
  );
  const ready = mine.filter((law) => gone.get(law) === undefined);
  const absentReadings = mine.flatMap((law) => {
    const artifact = gone.get(law);
    return artifact === undefined ? [] : [absent(law, artifact, tool)];
  });
  return ready.length === 0
    ? absentReadings
    : [...absentReadings, ...(await reader({ ...input, laws: ready }))];
}

/** The readings of every reader for the laws that map its tool, by law id. */
async function readAll(
  laws: readonly LawEntry[],
  input: Omit<ReadInput, "laws">,
  readers: ReadonlyMap<string, LawReader>,
): Promise<Map<string, LawReading[]>> {
  const byLaw = new Map<string, LawReading[]>();
  for (const [tool, reader] of readers) {
    for (const reading of await readTool(reader, tool, laws, input)) {
      byLaw.set(reading.law, [...(byLaw.get(reading.law) ?? []), reading]);
    }
  }
  return byLaw;
}

function judgeAll(
  laws: readonly LawEntry[],
  className: string,
  byLaw: ReadonlyMap<string, readonly LawReading[]>,
  read: ReadonlySet<string>,
): Judged[] {
  return laws.map((law) => {
    const given = byLaw.get(law.id) ?? [];
    const tools = new Set(toolsOf(law).filter((tool) => read.has(tool)));
    return judgeEntry(law, className, readingsOf(law, given, tools));
  });
}

/** The layer's verdict: the worst of every required law and every finding of the layer's own; a law not required is only counted. */
export function layerVerdict(judged: readonly Judged[], own: readonly RawFinding[]): Verdict {
  const required = judged.filter((one) => one.required).map((one) => one.verdict);
  return [...required, ...own.map((finding) => finding.verdict)].reduce(worse, "pass");
}

function resultOf(judged: readonly Judged[], own: readonly RawFinding[]): LayerResult {
  const findings = [...judged.flatMap((one) => [lawFinding(one), ...evidenceOf(one)]), ...own];
  return { verdict: layerVerdict(judged, own), findings, artifacts: {} };
}

/** The day an expiry is compared with: the runner's, else the machine's. */
const dayOf = (ctx: LayerContext): string => ctx.today ?? utcDate(new Date());

/** What reads the acknowledgements of a project: its comments and its ledger. */
export type AcksOf = (
  cwd: string,
  files: readonly string[],
  ledger: string,
  severity: SeverityOf,
) => Collected;

async function run(
  catalog: LawCatalog,
  readers: ReadonlyMap<string, LawReader>,
  acksOf: AcksOf,
  ctx: LayerContext,
): Promise<LayerResult> {
  const tracked = await trackedFiles(ctx);
  if ("finding" in tracked) {
    return { verdict: "fail", findings: [tracked.finding], artifacts: {} };
  }
  const source = trackedLinted(tracked.files);
  const runner = { cwd: ctx.cwd, env: ctx.env, exec: ctx.exec, outDir: ctx.outDir };
  const eslint = once(() => askEslint(runner, askedOf(source)));
  const { dependsOnAstro } = readProject(ctx.cwd);
  const laws = lawsOfProject(catalog(), ctx.config.class, dependsOnAstro).map((law) =>
    forClass(law, ctx.config.class),
  );
  const input = { ctx, tracked: tracked.files, held: ratchetHeld(ctx), eslint };
  const acks = acksOf(ctx.cwd, tracked.files, ledgerOf(ctx.config), severityOf(catalog()));
  const byLaw = ackAll(laws, await readAll(laws, input, readers), acks.acks, dayOf(ctx));
  const facts = await eslint();
  const own = [
    ...(facts.ok ? unlinted(source, facts.facts) : []),
    ...lawAckFindings(acks.problems),
  ];
  return resultOf(judgeAll(laws, ctx.config.class, byLaw, new Set(readers.keys())), own);
}

/** The inputs the laws layer reads of gate 1: ESLint's JSON and tsc's diagnostics, and each tool reader's own, optional. */
const CONSUMES: Layer["consumes"] = [
  { artifact: "eslint-json", from: "hygiene" },
  { artifact: "tsc-diagnostics", from: "hygiene" },
  ...optionalArtifacts().map((artifact) => ({ artifact, from: "hygiene", optional: true })),
];

/** The laws layer over a catalog of laws and the readers of each tool's rules. */
export const lawsLayer = (
  catalog: LawCatalog,
  readers = defaultReaders(),
  acksOf: AcksOf = collectAcks,
): Layer => ({
  id: "laws",
  gate: "laws",
  tier: 1,
  classes: classes(),
  requires: ["hygiene"],
  produces: [],
  consumes: CONSUMES,
  run: (ctx) => run(catalog, readers, acksOf, ctx),
});
