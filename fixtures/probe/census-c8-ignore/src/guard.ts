export function guard(n: number): number {
  /* c8 ignore next 3 */
  if (n < 0) {
    throw new Error("negative");
  }
  return n;
}
