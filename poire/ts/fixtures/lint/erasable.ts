// TS-POIRE counter-examples the compiler refuses under web-tops/tsconfig/strict.json.
// Each refused line ends in a `want` marker naming the diagnostic.

// TS-12: an enum emits runtime code, so Node's type stripping cannot run it.
// want-below TS1294
export enum Color {
  Red,
}

// TS-12: so does a namespace with values.
// want-below TS1294
export namespace Legacy {
  export const version = 1;
}

// TS-12: and so does a parameter property.
export class Store {
  constructor(private readonly name: string) {} // want TS1294

  get label(): string {
    return this.name;
  }
}

// TS-03: with noUncheckedIndexedAccess, an index may be undefined.
export function first(names: readonly string[]): string {
  const name: string = names[0]; // want TS2322
  return name;
}
