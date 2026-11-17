import { resolve } from "node:path";
import { expect } from "vitest";

export const fixturesDir = resolve(import.meta.dirname, "../../fixtures/config");

export function fixture(name: string): string {
  return resolve(fixturesDir, name);
}

/** One property of an unknown value, or undefined. */
export function get(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function plain(value: unknown): object | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

/** Dotted paths of every key under plain objects; arrays are leaves. */
export function keyPaths(value: unknown, prefix = ""): string[] {
  const object = plain(value);
  if (object === undefined) return [];
  return Object.keys(object).flatMap((key) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return [path, ...keyPaths(get(object, key), path)];
  });
}

/** The key paths (as arrays) of every plain object in a value, the root first. */
export function objectPaths(value: unknown, prefix: readonly string[] = []): string[][] {
  const object = plain(value);
  if (object === undefined) return [];
  return [
    [...prefix],
    ...Object.keys(object).flatMap((key) => objectPaths(get(object, key), [...prefix, key])),
  ];
}

/** The object at a key path, or undefined. */
export function at(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => get(node, key), value);
}

/** The own keys of an object or array, or none. */
export function keys(value: unknown): string[] {
  return typeof value === "object" && value !== null ? Object.keys(value) : [];
}

/** A deep copy of `value` with one property replaced, or removed when `replacement` is omitted. */
export function edit(value: unknown, path: readonly string[], ...replacement: [] | [unknown]): unknown {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  const parent = at(copy, path.slice(0, -1));
  const key = path.at(-1);
  if (typeof parent === "object" && parent !== null && key !== undefined) {
    if (replacement.length === 0) Reflect.deleteProperty(parent, key);
    else Reflect.set(parent, key, replacement[0]);
  }
  return copy;
}

// Asymmetric matchers are typed any; these hand them back as unknown so they can sit in objects.
export function containing(text: string): unknown {
  return expect.stringContaining(text);
}

export function matching(pattern: RegExp): unknown {
  return expect.stringMatching(pattern);
}

export function objectLike(fields: object): unknown {
  return expect.objectContaining(fields);
}
