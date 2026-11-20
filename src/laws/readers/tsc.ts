import { readOutput } from "../../layers/hygiene/tooling.ts";
import type { LawEntry, LawReader, LawReading, ReadInput } from "./types.ts";
import { trackedSource } from "./files.ts";
import { readDiagnostics } from "./tsc-diagnostics.ts";
import { readLaw, type Facts } from "./tsc-judge.ts";
import { readProjects } from "./tsc-projects.ts";

const failed = (law: LawEntry, reason: string): LawReading => ({
  law: law.id,
  verdict: "fail",
  reason,
  findings: [],
});

function missing(): string {
  return "the tsc diagnostics of gate 1 are missing or are not an array of diagnostics";
}

function diagnosticsOf(input: ReadInput): ReadonlyMap<string, number> | undefined {
  const path = input.ctx.artifacts.get("tsc-diagnostics");
  return path === undefined ? undefined : readDiagnostics(readOutput(path));
}

/**
 * The compiler reader: each checked project's flags through its `extends` chain, the tracked source no project holds
 * (section 8.2, W-04), and the diagnostics gate 1's `tsc -b` raised for a flag's laws. It runs no compile.
 */
export const tscReader: LawReader = (input) => {
  const read = readProjects(input.ctx.cwd);
  const diagnostics = diagnosticsOf(input);
  if (!read.ok || diagnostics === undefined) {
    const reason = read.ok ? missing() : read.message;
    return Promise.resolve(input.laws.map((law) => failed(law, reason)));
  }
  const facts: Facts = {
    projects: read.projects,
    source: trackedSource(input.tracked),
    diagnostics,
    held: input.held,
  };
  return Promise.resolve(input.laws.map((law) => readLaw(facts, law)));
};
