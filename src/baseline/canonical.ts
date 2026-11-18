function byKey([left]: readonly [string, unknown], [right]: readonly [string, unknown]): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value).sort(byKey);
  return Object.fromEntries(entries.map(([key, entry]) => [key, sorted(entry)]));
}

/** The one form the baseline is written in: sorted keys, two-space indent, a trailing newline, so no change is no diff. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}
