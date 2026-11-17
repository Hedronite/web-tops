export const sign = (n: number): string => (n > 0 && n < 100 ? "small" : n === 0 ? "zero" : "other");
