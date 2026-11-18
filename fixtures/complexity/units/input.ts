export function factory(): unknown {
  class Local { method(a: number): number { return a ? 1 : 0; } }
  class Other { field = (b: number): number => b || 1; }
  return new Local();
}
export const api = {
  get(a: number): number { return a ? 1 : 0; },
  nested(): () => number { return () => 1; },
  handler: (a: number): number => a || 1,
};
export namespace Space { export function inside(a: number): number { return a ? 1 : 0; } }
export default function (a: number): number { return a ? 1 : 0; }
