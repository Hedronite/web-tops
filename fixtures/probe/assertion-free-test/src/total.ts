export function total(xs: readonly number[]): number {
  let sum = 0;
  for (const x of xs) {
    sum += x;
  }
  return sum;
}
