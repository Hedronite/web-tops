type Shape = "circle" | "square";

export function sides(shape: Shape): number {
  switch (shape) { // expect: switch-exhaustiveness-check
    case "circle":
      return 0;
  }
  return 4;
}
