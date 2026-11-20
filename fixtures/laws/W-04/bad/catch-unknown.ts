export function run(action: () => void): string {
  try {
    action();
    return "";
  } catch (error) {
    return error.message; // expect: useUnknownInCatchVariables, no-unsafe-return
  }
}
