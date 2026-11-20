const text: unknown = "text";

export const narrowed = typeof text === "string" ? text : "";

export const direction = "up" as const;

export const first = (items: readonly string[]): string => items[0] ?? "";
