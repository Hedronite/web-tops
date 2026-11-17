import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Reads one key path out of a parsed document of unknown shape; undefined when any step is absent. */
export function at(doc: unknown, ...path: readonly string[]): unknown {
  let node: unknown = doc;
  for (const key of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = Reflect.get(node, key);
  }
  return node;
}

const made: string[] = [];

/** A fresh empty directory under the OS temp directory. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-init-"));
  made.push(dir);
  return dir;
}

/** Every directory tempDir() handed out, so a test file can remove them afterwards. */
export function madeDirs(): readonly string[] {
  return made;
}

/** Writes a file, creating its directories. */
export function put(dir: string, relative: string, text: string): void {
  const target = join(dir, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

/**
 * An environment whose PATH holds only fake programs that print the given text for `--version`, so
 * a test controls which Node and Bun a command finds. A program left out is not on the PATH.
 */
export function fakeHost(versions: Readonly<Record<string, string>>): Record<string, string> {
  const bin = tempDir();
  for (const [name, text] of Object.entries(versions)) {
    put(bin, name, `#!/bin/sh\necho "${text}"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return { PATH: bin };
}

/** Every file under dir as relative path to contents, sorted by path. */
export function snapshot(dir: string): ReadonlyMap<string, string> {
  const out = [...filesUnder(dir, "")].map((path): [string, string] => [
    path,
    readFileSync(join(dir, path), "utf8"),
  ]);
  return new Map(out.sort(([a], [b]) => a.localeCompare(b)));
}

function* filesUnder(dir: string, sub: string): Generator<string> {
  for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) {
    const relative = sub === "" ? entry.name : `${sub}/${entry.name}`;
    if (entry.isDirectory()) yield* filesUnder(dir, relative);
    else yield relative;
  }
}
