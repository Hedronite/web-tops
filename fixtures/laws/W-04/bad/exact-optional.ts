interface Options {
  readonly level?: number;
}

export const options: Options = { level: undefined }; // expect: exactOptionalPropertyTypes
