export function guard(n: number): number {
  /* istanbul ignore next */
  if (n < 0) {
    throw new Error("negative");
  }
  return n;
}
