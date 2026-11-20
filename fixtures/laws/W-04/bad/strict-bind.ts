function add(a: number, b: number): number {
  return a + b;
}

export const total = add.call(undefined, 1, "2"); // expect: strictBindCallApply
