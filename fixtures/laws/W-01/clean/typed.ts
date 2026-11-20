export const total: number = 1;

export function show(value: unknown): string {
  return typeof value === "string" ? value : "not text";
}

export function parse(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}
