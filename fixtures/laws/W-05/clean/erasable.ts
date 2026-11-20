export const Color = { Red: "red" } as const;
export type Color = (typeof Color)[keyof typeof Color];

export const unit = 1;

export class Point {
  readonly x: number;

  constructor(x: number) {
    this.x = x;
  }
}
