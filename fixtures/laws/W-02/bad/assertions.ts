const text: unknown = "text";

export const forced = text as string; // expect: consistent-type-assertions

export const angled = <string>text; // expect: consistent-type-assertions, erasableSyntaxOnly

export const first = (items: string[]): string => items[0]!; // expect: no-non-null-assertion
