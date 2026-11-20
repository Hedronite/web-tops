import type { LawProbe, ProbeReport } from "./types.ts";

function lawLines(probe: LawProbe): string[] {
  const head = `${probe.id}  ${probe.verdict}`;
  const unrelated =
    probe.unrelated.length === 0
      ? []
      : [
          `  ${String(probe.unrelated.length)} finding(s) on its twins that no rule of the law explains`,
        ];
  return [head, ...probe.failures.map((failure) => `  ${failure.message}`), ...unrelated];
}

/** The text of a probe: one block for each law, then how many held. */
export function probeText(report: ProbeReport): string {
  const passed = report.laws.filter((probe) => probe.verdict === "pass").length;
  const total = `${String(passed)} of ${String(report.laws.length)} laws probed pass`;
  const skipped = report.skipped.map((twin) => `skipped ${twin.file}: ${twin.reason}`);
  return `${[...report.laws.flatMap(lawLines), ...skipped, total].join("\n")}\n`;
}

export const probeExit = (report: ProbeReport): 0 | 1 =>
  report.laws.every((probe) => probe.verdict === "pass") ? 0 : 1;
