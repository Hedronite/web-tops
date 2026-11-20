export function name(text: string): string {
  const data = JSON.parse(text); // expect: no-unsafe-assignment
  return String(data.name); // expect: no-unsafe-member-access
}

export function title(text: string): string {
  const body = JSON.parse(text); // expect: no-unsafe-assignment
  return String(body.title); // expect: no-unsafe-member-access
}

export function call(text: string): void {
  const parsed = JSON.parse(text); // expect: no-unsafe-assignment
  parsed(); // expect: no-unsafe-call
}

export function back(text: string): string {
  const parsed = JSON.parse(text); // expect: no-unsafe-assignment
  return parsed; // expect: no-unsafe-return
}

export function pass(text: string): number {
  const parsed = JSON.parse(text); // expect: no-unsafe-assignment
  return Math.abs(parsed); // expect: no-unsafe-argument
}
