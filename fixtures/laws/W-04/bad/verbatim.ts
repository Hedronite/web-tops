import { Shape } from "./_shape.ts"; // expect: verbatimModuleSyntax, consistent-type-imports

export const sides = (shape: Shape): number => shape.sides;
