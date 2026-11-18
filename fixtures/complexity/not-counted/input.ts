export function typeLevel<T>(a: T extends string ? number : boolean): void {}
export function asAndSatisfies(a: unknown): number { return (a as number) satisfies number; }
export function overloaded(a: string): string;
export function overloaded(a: number): number;
export function overloaded(a: string | number): string | number { return a; }
declare function ambient(a: number): number;
export interface Shaped { area(): number; }
export type Mapped<T> = { [K in keyof T]: T[K] extends string ? K : never };
export abstract class Shape { abstract area(): number; describe(): string { return this.area() > 1 ? "big" : "small"; } }
