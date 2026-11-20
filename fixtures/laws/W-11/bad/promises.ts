function save(): Promise<void> {
  return Promise.resolve();
}

export function floating(): void {
  save(); // expect: no-floating-promises
}

export function misused(items: readonly string[]): void {
  items.forEach(async (item) => { await save(); item.toUpperCase(); }); // expect: no-misused-promises
}

export async function thenable(): Promise<number> {
  const value = await 1; // expect: await-thenable
  return value;
}
