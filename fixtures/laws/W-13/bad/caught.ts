export function wrap(action: () => void): void {
  try {
    action();
  } catch (error) {
    throw new Error(`failed: ${String(error)}`); // expect: preserve-caught-error
  }
}

export function recover(task: Promise<string>): Promise<string> {
  return task.catch((reason: Error) => reason.message); // expect: use-unknown-in-catch-callback-variable
}
