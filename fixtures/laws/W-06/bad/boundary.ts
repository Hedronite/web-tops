export function name(text: string): string {
  const data = JSON.parse(text); // expect: no-unsafe-assignment
  return String(data.name); // expect: no-unsafe-member-access
}

export function title(text: string): string {
  const body = JSON.parse(text); // expect: no-unsafe-assignment
  return String(body.title); // expect: no-unsafe-member-access
}
