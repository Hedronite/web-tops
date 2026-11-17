export function risky(n: number): number {
  if (n > 10) {
    return n - 10;
  }
  return n > 5 ? n : 0;
}
