// expect: ban-ts-comment
// @ts-ignore
export const ignored: number = "text";

// expect: ban-ts-comment
// @ts-expect-error
export const expected: number = "text";

// expect: require-description
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const described: any = 1;

// expect: no-unlimited-disable, require-description
// eslint-disable-next-line
export const unlimited: any = 1;

// expect: reportUnusedDisableDirectives, require-description
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const unused = 1;
