import type { Shape } from "./_shape.ts";

export type { Shape };

const items: readonly string[] = ["a"];
export const size = (items[0] ?? "").length;

interface Options {
  readonly level?: number;
}
export const options: Options = {};

class Base {
  run(): number {
    return 1;
  }
}
export class Child extends Base {
  override run(): number {
    return 2;
  }
}

export function label(kind: number): string {
  switch (kind) {
    case 1:
      return "one";
    default:
      return "other";
  }
}

export const sides = (shape: Shape): number => shape.sides;

export function length(value: string | undefined): number {
  return value === undefined ? 0 : value.length;
}

export class Counter {
  count: number;

  constructor() {
    this.count = 0;
  }
}

export function run(action: () => void): string {
  try {
    action();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "unknown";
  }
}
