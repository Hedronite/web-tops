export function noBranch(a: number): number { return a; }
export function ifOnly(a: number): number { if (a) return 1; return 0; }
export function elseIf(a: number): number { if (a === 1) return 1; else if (a === 2) return 2; else return 3; }
export function ternary(a: number): number { return a ? 1 : 2; }
export function nestedTernary(a: number, b: number): number { return a ? (b ? 1 : 2) : 3; }
export function caseTwo(a: number): number { switch (a) { case 1: return 1; case 2: return 2; default: return 0; } }
export function caseNoDefault(a: number): number { switch (a) { case 1: return 1; case 2: return 2; } return 0; }
export function caseGrouped(a: number): number { switch (a) { case 1: case 2: case 3: return 1; default: return 0; } }
export function onlyDefault(a: number): number { switch (a) { default: return a; } }
export function forLoop(): number { let n = 0; for (let i = 0; i < 3; i++) n += i; return n; }
export function forIn(o: object): number { let n = 0; for (const k in o) n += k.length; return n; }
export function forOf(a: number[]): number { let n = 0; for (const x of a) n += x; return n; }
export async function forAwait(a: AsyncIterable<number>): Promise<number> { let n = 0; for await (const x of a) n += x; return n; }
export function whileLoop(a: number): number { while (a > 0) a--; return a; }
export function doLoop(a: number): number { do { a--; } while (a > 0); return a; }
export function catchOnly(): number { try { return 1; } catch (e) { return 2; } }
export function finallyOnly(): number { try { return 1; } finally { console.log(1); } }
export function andOr(a: boolean, b: boolean, c: boolean): boolean { return (a && b) || c; }
export function logicalAssign(a: number | undefined, b: number | undefined): void { a &&= 1; b ||= 2; }
export function mixed(a: number, b: number): number { if (a && b) { return a || b ? 1 : 0; } return 0; }
export function elseOnly(a: number): number { if (a) { return 1; } else { return 2; } }
export function bitwise(a: number, b: number): number { return (a & b) | (a ^ b); }
export function negation(a: number): boolean { return !a; }
