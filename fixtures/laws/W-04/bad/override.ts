class Base {
  run(): number {
    return 1;
  }
}

export class Child extends Base {
  run(): number { // expect: noImplicitOverride
    return 2;
  }
}
