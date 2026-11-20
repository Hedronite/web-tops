declare const loose: any; // expect: no-explicit-any

export const assigned: string = loose; // expect: no-unsafe-assignment

export function member(): string {
  return String(loose.field); // expect: no-unsafe-member-access
}

export function called(): void {
  loose(); // expect: no-unsafe-call
}

export function returned(): string {
  return loose; // expect: no-unsafe-return
}

export function argument(): number {
  return Math.abs(loose); // expect: no-unsafe-argument
}
