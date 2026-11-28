/** A guide listed on the guides page. */
export interface Guide {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly minutes: number;
}

export const guides = (): readonly Guide[] => [
  {
    id: "start",
    title: "Start a project",
    summary: "Run init and read what it wrote.",
    minutes: 4,
  },
  { id: "gate", title: "Read the gate", summary: "What each layer judges, and why.", minutes: 7 },
];

/** "1 minute" or "n minutes". */
export function readingTime(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
}
