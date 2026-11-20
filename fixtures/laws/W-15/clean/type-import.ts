import type { Shape } from "./_shape.ts";
import { type Shape as Same } from "./_shape.ts";

export const sides = (shape: Shape): number => shape.sides;
export const same = (shape: Same): number => shape.sides;
