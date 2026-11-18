export class Box {
  static count = 0;
  value = (): number => (this.n ? 1 : 0);
  constructor(private n: number) { if (n) this.n = n; }
  get size(): number { return this.n || 0; }
  set size(v: number) { this.n = v ?? 0; }
  static { if (Box.count) Box.count = 1; }
  run(items: number[]): number {
    return items.filter((x) => x && this.n).length;
  }
  #hidden(): number { return 1; }
  [Symbol.iterator](): number { return 1; }
}
