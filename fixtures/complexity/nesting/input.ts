export function outer(items: number[]): number {
  let n = 0;
  items.forEach((x) => { if (x) n += x; });
  function inner(y: number): number { return y ? 1 : 0; }
  return n + inner(1);
}
export const arrow = (a: number): number => (a ? 1 : 2);
export const exprBody = (a: number) => a && a > 1;
export function deep(a: number): number {
  return [a].map((x) => [x].map((y) => (y ? 1 : 0)).length)[0] ?? 0;
}
export const iife = (() => 1)();
export function usesIife(): number { return (() => { return 1; })(); }
