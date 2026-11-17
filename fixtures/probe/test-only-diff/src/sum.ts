export function sum(xs: readonly number[]): number {
  let total = 0;
  for (const x of xs) {
    total += x;
  }
  return total;
}
