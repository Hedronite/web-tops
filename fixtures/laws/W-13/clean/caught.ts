export function wrap(action: () => void): void {
  try {
    action();
  } catch (error) {
    throw new Error("failed", { cause: error });
  }
}

export function recover(task: Promise<string>): Promise<string> {
  return task.catch((reason: unknown) => (reason instanceof Error ? reason.message : "unknown"));
}

export function run(action: () => void): string {
  try {
    action();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "unknown";
  }
}
