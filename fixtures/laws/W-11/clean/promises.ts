function save(): Promise<void> {
  return Promise.resolve();
}

export async function awaited(): Promise<void> {
  await save();
}

export function deliberate(): void {
  void save();
}

export async function each(items: readonly string[]): Promise<void> {
  for (const item of items) {
    await save();
    item.toUpperCase();
  }
}

export async function thenable(): Promise<number> {
  const value = await Promise.resolve(1);
  return value;
}
