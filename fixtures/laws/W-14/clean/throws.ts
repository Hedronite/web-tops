export function fail(): never {
  throw new Error("failed");
}

export function later(): Promise<void> {
  return Promise.reject(new Error("failed"));
}
