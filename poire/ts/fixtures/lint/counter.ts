// TS-POIRE counter-examples. Do not copy them.
//
// Each violating line ends in a `want` marker naming the rule that must report it. The lint proof
// in src/lintproof.test.ts fails on a marker with no finding and on a finding with no marker.
// TS-13: a type imported as a value.
import { Order } from "./types.ts"; // want @typescript-eslint/consistent-type-imports

declare function save(id: string): Promise<void>;

// TS-01: a cast is a promise to the compiler that nothing checks.
export function parseOrder(text: string): Order {
  return JSON.parse(text) as Order; // want @typescript-eslint/consistent-type-assertions
}

// TS-03: `!` silences the undefined that noUncheckedIndexedAccess reported.
export function firstLabel(labels: readonly string[]): string {
  return labels[0]!.trim(); // want @typescript-eslint/no-non-null-assertion
}

// TS-01: `any` switches the checker off for everything it touches.
// want-below @typescript-eslint/no-explicit-any
export function count(values: any[]): number {
  return values.length;
}

// TS-07: nobody waits for this promise, or hears that it failed.
export function saveLater(id: string): void {
  save(id); // want @typescript-eslint/no-floating-promises
}

// TS-07: forEach ignores the promises its callback returns.
export function saveAll(ids: readonly string[]): void {
  // want-below @typescript-eslint/no-misused-promises
  ids.forEach(async (id) => {
    await save(id);
  });
}

// TS-24: independent saves, one after another.
export async function saveInTurn(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await save(id); // want no-await-in-loop
  }
}

// TS-05: a state the switch forgot.
export function label(order: Order): string {
  // want-below @typescript-eslint/switch-exhaustiveness-check
  switch (order.status) {
    case "pending":
      return "waiting";
  }
  return "unknown";
}

// TS-06: the caught value is typed any, and is used as if it were an Error.
export function report(job: Promise<void>): void {
  // want-below @typescript-eslint/use-unknown-in-catch-callback-variable
  void job.catch((error) => {
    console.error(error.message); // want @typescript-eslint/no-unsafe-member-access
  });
}

// TS-06: a string thrown has no stack and no cause.
export function fail(): never {
  throw "boom"; // want @typescript-eslint/only-throw-error
}

// TS-06: the new error drops the one it replaced.
export function load(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`could not load: ${String(error)}`); // want preserve-caught-error
  }
}

// TS-10: method shorthand is checked bivariantly; a property signature is checked soundly.
export interface Handler {
  onEvent(event: Event): void; // want @typescript-eslint/method-signature-style
}

// TS-01: @ts-ignore hides an error and says nothing about why.
// @ts-ignore // want @typescript-eslint/ban-ts-comment
export const legacy = 1;
