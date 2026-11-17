export function discount(total: number, member: boolean): number {
  if (member && total > 100) {
    return total * 0.9;
  }
  return total;
}

export function untested(n: number): number {
  return n > 0 ? n + 1 : n - 1;
}
