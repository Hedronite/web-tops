export function weigh(kind: number): number {
  let total = 0;
  switch (kind) {
    case 1: // expect: noFallthroughCasesInSwitch
      total += 1;
    case 2: // expect: no-fallthrough
      total += 2;
      break;
    default:
      break;
  }
  return total;
}
