export function dup(a: number): number { return a; }
if (Math.random() > 2) { function dup(a: number): number { return a ? 1 : 2; } }
export const list = [() => 1, function () { return 2; }, () => (3 ? 4 : 5)];
const named = function inner(): number { return 1; };
const o = { ["computed"]: () => 1, [Symbol.toPrimitive]() { return 1; }, "quoted-key"() { return 2; }, 42() { return 3; } };
(exports as any).assigned = () => 1;
let lateBound: () => number; lateBound = () => 1;
