// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the legacy API hands out any
export const legacy: any = 1;

// @ts-expect-error -- the value is wrong on purpose, to show the directive
export const wrong: number = "text";
