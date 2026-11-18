/**
 * Vitest gives a test 5 s. A test that starts a real tool (Vitest, ESLint, tsc in a temp project) needs more on a
 * cold or slow runner: the macOS CI leg timed out a real Vitest run at 5000 ms. Each such test sets this per
 * test; the kit's global timeout stays at the default, so a test that hangs by mistake still fails fast.
 */
export const REAL_TOOL_TIMEOUT = 60_000;
