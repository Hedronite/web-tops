import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Temporary directories a test makes, removed by `cleanTemp` (put it in `afterAll`). */
const made: string[] = [];

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-probe-"));
  made.push(dir);
  return dir;
}

export function cleanTemp(): void {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes files, given as `{ "a/b.ts": "text" }`, under a directory. */
export function put(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}
