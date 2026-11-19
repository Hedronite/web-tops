export enum Color { // expect: erasableSyntaxOnly
  Red,
}

export namespace Shapes { // expect: erasableSyntaxOnly, no-namespace
  export const unit = 1;
}

export class Point {
  constructor(public readonly x: number) {} // expect: erasableSyntaxOnly
}
