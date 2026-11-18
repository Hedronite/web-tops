import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fireOf, installedVersion, present, ROOT, toKey } from "./support.ts";
import type { Fire, Observation } from "./types.ts";

const BIN = join(ROOT, "node_modules", ".bin", "oxlint");
const FIXTURE_DIRS = ["fixtures/rules", "fixtures/claims"];

function oxlint(args: readonly string[]): string {
  return spawnSync(BIN, [...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }).stdout;
}

/** The jsx-a11y rules oxlint lists: table rows whose source column is jsx_a11y. */
export function listedRules(): string[] {
  return oxlint(["--rules"])
    .split("\n")
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells[2] === "jsx_a11y")
    .map((cells) => cells[1] ?? "")
    .sort();
}

function fixturePaths(): string[] {
  return FIXTURE_DIRS.flatMap((dir) =>
    readdirSync(join(ROOT, dir)).map((name) => toKey(join(ROOT, dir, name))),
  );
}

function configFor(names: readonly string[]): string {
  const rules = Object.fromEntries(names.map((name) => [`jsx-a11y/${name}`, "error"]));
  return JSON.stringify({ plugins: ["jsx-a11y"], categories: {}, rules });
}

interface Diagnostic {
  readonly code?: string;
  readonly severity?: string;
  readonly filename?: string;
}

function toFire(diagnostic: Diagnostic): Fire | undefined {
  const match = /^jsx-a11y\((.+)\)$/.exec(diagnostic.code ?? "");
  const ruleId = match?.[1] === undefined ? null : `a11y/${match[1]}`;
  return fireOf("a11y/", { ruleId, fatal: diagnostic.severity === "error" });
}

function add(files: Record<string, Fire[]>, diagnostic: Diagnostic): void {
  const fire = toFire(diagnostic);
  const key = diagnostic.filename;
  if (fire !== undefined && key !== undefined) (files[key] ??= []).push(fire);
}

function collect(diagnostics: readonly Diagnostic[]): Record<string, Fire[]> {
  const files: Record<string, Fire[]> = Object.fromEntries(fixturePaths().map((p) => [p, []]));
  for (const diagnostic of diagnostics) add(files, diagnostic);
  return files;
}

function hasDiagnostics(value: unknown): value is { diagnostics: unknown } {
  return typeof value === "object" && value !== null && "diagnostics" in value;
}

function diagnosticsOf(stdout: string): Diagnostic[] {
  const parsed: unknown = JSON.parse(stdout);
  const list = hasDiagnostics(parsed) ? parsed.diagnostics : [];
  return Array.isArray(list) ? list.filter(present) : [];
}

export function observeOxlint(): Observation {
  const names = listedRules();
  const dir = mkdtempSync(join(tmpdir(), "w22-oxlint-"));
  try {
    const config = join(dir, "oxlintrc.json");
    writeFileSync(config, configFor(names));
    const out = oxlint(["-c", config, "--jsx-a11y-plugin", "-f", "json", ...FIXTURE_DIRS]);
    return {
      engine: "oxlint",
      version: installedVersion("oxlint"),
      implemented: names,
      deprecated: [],
      replaced_by: {},
      files: collect(diagnosticsOf(out)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
