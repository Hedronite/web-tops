import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ProbeLaw } from "./types.ts";

/** The one directory a test run keeps its temporary directories in, made the first time one is asked for. */
let parent: string | undefined;

/** A new temporary directory, inside the run's own directory that `cleanTemp` removes whole (put it in `afterAll`). */
export function tempDir(): string {
  parent ??= mkdtempSync(join(tmpdir(), "wt-probe-"));
  return mkdtempSync(join(parent, "d-"));
}

/** Removes every directory `tempDir` made, with what is in them. Nothing made is nothing to remove. */
export function cleanTemp(): void {
  if (parent !== undefined) {
    rmSync(parent, { recursive: true, force: true });
    parent = undefined;
  }
}

/** Writes files, given as `{ "a/b.ts": "text" }`, under a directory. */
export function put(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

/**
 * The laws the probe proves on this repository, as the catalog gives them, read by a process of their own: a test that
 * needs them does not run the catalog's loader in its own, so what that loader costs is not charged to the test. One
 * line for each law: its id, its proofs and its classes, apart by spaces, and the lists by commas.
 */
export function kitProbeLaws(): ProbeLaw[] {
  const script =
    'import { catalogLaws } from "./src/laws/probe/catalog.ts"; for (const law of catalogLaws()) console.log([law.id, law.proofs.join(","), (law.classes ?? []).join(",")].join(" "));';
  const run = spawnSync("bun", ["-e", script], {
    cwd: resolve(import.meta.dirname, "../../.."),
    encoding: "utf8",
  });
  return run.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => lawOfLine(line));
}

function lawOfLine(line: string): ProbeLaw {
  const [id, proofs, classes] = line.split(" ");
  return { id: String(id), proofs: String(proofs).split(","), classes: String(classes).split(",") };
}
