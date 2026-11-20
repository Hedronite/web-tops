type Handler = (value: string | number) => number;

const narrow = (value: string): number => value.length;

export const handler: Handler = narrow; // expect: strictFunctionTypes
