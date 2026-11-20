import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
