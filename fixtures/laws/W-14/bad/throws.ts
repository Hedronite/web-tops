export function fail(): never {
  throw "failed"; // expect: only-throw-error
}

export function later(): Promise<void> {
  return Promise.reject("failed"); // expect: prefer-promise-reject-errors
}
