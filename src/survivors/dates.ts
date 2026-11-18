const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAY_MS = 86_400_000;

/** The time of that calendar day's start in UTC, or undefined when the text is not a real `YYYY-MM-DD` date. */
function startOf(date: string): number | undefined {
  const found = DATE.exec(date);
  if (found === null) return undefined;
  const [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])];
  const time = Date.UTC(year, month - 1, day);
  return new Date(time).toISOString().slice(0, 10) === date ? time : undefined;
}

/** True for a real calendar date written `YYYY-MM-DD`: not `2026-02-30`, not `2026-13-01`, not `soon`. */
export const isCalendarDate = (text: string): boolean => startOf(text) !== undefined;

/** The UTC calendar date of a moment, `YYYY-MM-DD`. Every date in the ledger is UTC, whatever the machine's zone. */
export const utcDate = (now: Date): string => now.toISOString().slice(0, 10);

/** True once `today` is after `expires`: an entry is valid through the day it names. */
export function isExpired(expires: string | undefined, today: string): boolean {
  return expires !== undefined && today > expires;
}

/** Whole days from `today` to `expires` (0 on the day itself, negative once past), or undefined with no expiry. */
export function daysLeft(expires: string | undefined, today: string): number | undefined {
  const end = expires === undefined ? undefined : startOf(expires);
  const start = startOf(today);
  return end === undefined || start === undefined ? undefined : Math.round((end - start) / DAY_MS);
}
