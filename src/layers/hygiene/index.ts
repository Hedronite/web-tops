import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RawFinding } from "../../report/findings.ts";
import type { Verdict } from "../../report/types.ts";
import {
  HYGIENE_STEPS,
  type HygieneSettings,
  type HygieneStep,
  type Layer,
  type LayerContext,
  type LayerResult,
} from "../../gate/types.ts";
import { isCountable, ratchetHeld } from "../../baseline/state.ts";
import { audit } from "./audit.ts";
import { astroCheck, install, tsc } from "./build.ts";
import { dependencyCruiser, eslint, format, stylelint } from "./lint.ts";
import { packageExports } from "./package.ts";
import { readPackage, runTool, type StepContext, type StepResult } from "./tooling.ts";

/** The class profile (src/config/profiles.ts) decides which steps a class maps; the adapter writes the rest as disabled switches with a reason. */
const LAUNCH_CLASSES = ["ts-library", "ui-components", "astro-site", "web-app", "node-service"];

/** The files this layer leaves in `.web-tops/out/hygiene/`, by name. */
const ARTIFACTS = [
  "audit-json",
  "eslint-json",
  "stylelint-json",
  "dependency-cruiser-json",
  "tsc-diagnostics",
  "install-json",
  "publint-json",
  "attw-json",
  "astro-check-json",
];

const WORST_FIRST: readonly Verdict[] = ["fail", "not-run", "not-evaluated", "ack-missing"];

/** The worst verdict among findings, in the order that tells a reader what to do first. */
function aggregate(findings: readonly RawFinding[]): Verdict {
  for (const verdict of WORST_FIRST) {
    if (findings.some((finding) => finding.verdict === verdict)) {
      return verdict;
    }
  }
  return "pass";
}

function stylelintGlobs(step: StepContext): string[] {
  return step.ctx.config.class === "astro-site" ? ["**/*.css", "**/*.astro"] : ["**/*.css"];
}

const RUNNERS: Readonly<Record<HygieneStep, (step: StepContext) => Promise<StepResult>>> = {
  install,
  tsc,
  astro_check: astroCheck,
  eslint,
  stylelint: (step) => stylelint(step, stylelintGlobs(step)),
  format,
  dependency_cruiser: dependencyCruiser,
  audit,
  package_exports: packageExports,
};

/** A step the config or the class switches off is a `skip` finding with its reason. */
function disabled(key: HygieneStep, settings: HygieneSettings): RawFinding | undefined {
  const toggle = settings.steps[key];
  return toggle?.enabled === false
    ? {
        tool: "webtops",
        rule: `step:${key}`,
        verdict: "skip",
        message: toggle.reason ?? "disabled in web-tops.yaml",
      }
    : undefined;
}

async function stepOutcome(
  key: HygieneStep,
  step: StepContext,
  installFailed: boolean,
): Promise<StepResult> {
  const off = disabled(key, step.settings);
  if (off !== undefined) {
    return { findings: [off] };
  }
  if (installFailed) {
    return {
      findings: [
        {
          tool: "webtops",
          rule: `step:${key}`,
          verdict: "not-run",
          message: "stopped: install failed",
        },
      ],
    };
  }
  return RUNNERS[key](step);
}

function failedInstall(key: HygieneStep, outcome: StepResult): boolean {
  return key === "install" && outcome.findings.some((finding) => finding.verdict === "fail");
}

function stepContext(ctx: LayerContext): StepContext {
  const dir = join(ctx.outDir, "hygiene");
  mkdirSync(dir, { recursive: true });
  return {
    ctx,
    settings: ctx.config.hygiene,
    run: (tool, args) => runTool(ctx, tool, args),
    dir,
    out: (name) => join(dir, name),
    pkg: readPackage(ctx.cwd),
  };
}

/** The findings a held ratchet may hold: counted ones that failed. */
const heldBy = (finding: RawFinding): boolean => finding.verdict === "fail" && isCountable(finding);

/**
 * Under `ratchet` with a baseline, a counted finding does not end the run on its own: the ratchet refuses a count
 * above the baseline's, per rule per file, so the layer's verdict leaves those findings out, and says how many it
 * left. Each one stays in the report as the tool said it, because the baseline is projected from them. A failure
 * that is not a counted finding still fails (WEB_TOPS.md section 6.7).
 */
function outcome(ctx: LayerContext, findings: readonly RawFinding[]): LayerResult {
  const held = ratchetHeld(ctx) ? findings.filter(heldBy) : [];
  if (held.length === 0)
    return { verdict: aggregate(findings), findings: [...findings], artifacts: {} };
  const note: RawFinding = {
    tool: "webtops",
    rule: "ratchet-held",
    verdict: "pass",
    message: `${String(held.length)} findings held by the baseline; a count above it is the ratchet's to refuse`,
  };
  const rest = findings.filter((finding) => !heldBy(finding));
  return { verdict: aggregate(rest), findings: [...findings, note], artifacts: {} };
}

async function run(ctx: LayerContext): Promise<LayerResult> {
  const step = stepContext(ctx);
  const findings: RawFinding[] = [];
  const artifacts: Record<string, string> = {};
  let installFailed = false;
  for (const key of HYGIENE_STEPS) {
    const outcomeOfStep = await stepOutcome(key, step, installFailed);
    findings.push(...outcomeOfStep.findings);
    Object.assign(artifacts, outcomeOfStep.artifacts);
    installFailed = installFailed || failedInstall(key, outcomeOfStep);
  }
  return { ...outcome(ctx, findings), artifacts };
}

/** Gate 1: hygiene (WEB_TOPS.md section 3.1). Each tool runs once; ESLint's JSON stays in `.web-tops/out/hygiene/`. */
export const hygieneLayer: Layer = {
  id: "hygiene",
  gate: 1,
  tier: 1,
  classes: LAUNCH_CLASSES,
  requires: [],
  produces: ARTIFACTS,
  consumes: [],
  run,
};
