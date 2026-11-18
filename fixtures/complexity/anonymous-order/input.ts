export function host(): void {
  run(() => 1);
  run(function () { return 2; });
  run(() => 3);
}
export function other(): void { run(() => 1); }
run(() => 1);
