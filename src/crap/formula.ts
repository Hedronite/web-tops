/** CRAP(f) = comp(f)^2 * (1 - cov(f))^3 + comp(f), with cov(f) in [0, 1] (WEB_TOPS.md section 6.2). */
export function crapOf(complexity: number, cov: number): number {
  return complexity ** 2 * (1 - cov) ** 3 + complexity;
}
