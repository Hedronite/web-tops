export async function* gen(a: number): AsyncGenerator<number> { if (a) yield a; }
export const asyncArrow = async (a: number): Promise<number> => (a ? 1 : 2);
export function* plain(): Generator<number> { yield 1; }
export function withDefault(a = (b: number) => (b ? 1 : 0)): number { return a(1); }
