import type { SizeLimitSettings } from "../../gate/types.ts";

/** Default per-entry brotli byte ceiling (50 KiB) when config sets no override (WEB_TOPS.md §5.2/§7). */
export const DEFAULT_ENTRY_BYTES = 50 * 1024;

function entrySpecificLimit(
  key: string,
  entries: Readonly<Record<string, number>> | undefined,
): number | undefined {
  return entries === undefined ? undefined : entries[key];
}

/** Byte budget for one `package.json` `exports` key: explicit entry budget, else `default_bytes`, else class default. */
export function budgetForEntry(key: string, settings: SizeLimitSettings | undefined): number {
  if (settings === undefined) return DEFAULT_ENTRY_BYTES;
  return entrySpecificLimit(key, settings.entries) ?? settings.defaultBytes ?? DEFAULT_ENTRY_BYTES;
}
