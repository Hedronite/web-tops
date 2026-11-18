export function coalesce(a?: number): number { return a ?? 1; }
export function coalesceAssign(a: { x?: number }): void { a.x ??= 1; }
export function optionalProperty(a?: { x: number }): number | undefined { return a?.x; }
export function optionalElement(a?: number[]): number | undefined { return a?.[0]; }
export function optionalCall(a?: () => number): number | undefined { return a?.(); }
export function optionalChainLong(a?: { b?: { c: number } }): number | undefined { return a?.b?.c; }
export function nullishWithBranches(a?: number, b?: number): number { return (a ?? b ?? 0) && a ? 1 : 2; }
export function defaultParam(a: number = 1): number { return a; }
export function nonNull(a?: { x: number }): number { return a!.x; }
