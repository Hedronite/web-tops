export function clamp(n: number, low: number, high: number): number {
  // Stryker disable next-line all: boundary is equivalent here, tracked elsewhere
  if (n < low) return low;
  return Math.min(n, high);
}
