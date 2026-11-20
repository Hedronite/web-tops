import { describe, expect, it } from "vitest";
import { codesOf, readDiagnostics } from "./tsc-diagnostics.ts";

describe("G4b the compiler codes each flag raises, and gate 1's diagnostics counted by code", () => {
  it("maps noImplicitAny to TS7005 and TS7006, and the other flags to their own codes", () => {
    expect(codesOf("noImplicitAny")).toEqual(expect.arrayContaining(["TS7005", "TS7006"]));
    expect(codesOf("strictNullChecks")).toEqual(expect.arrayContaining(["TS2532", "TS18047"]));
    expect(codesOf("erasableSyntaxOnly")).toEqual(["TS1294"]);
    expect(codesOf("verbatimModuleSyntax")).toEqual(["TS1484", "TS1485"]);
    expect(codesOf("noFallthroughCasesInSwitch")).toEqual(["TS7029"]);
    expect(codesOf("useUnknownInCatchVariables")).toEqual(["TS18046"]);
  });

  it("gives a flag whose errors are shared with other errors no code, and a name that is no flag none", () => {
    for (const flag of [
      "strictFunctionTypes",
      "strictBindCallApply",
      "alwaysStrict",
      "strictBuiltinIteratorReturn",
      "nonsense",
    ]) {
      expect(codesOf(flag)).toEqual([]);
    }
  });

  it("no code is a generic type error that every kind of mistake raises", () => {
    const all = [
      "noImplicitAny",
      "strictNullChecks",
      "noUncheckedIndexedAccess",
      "isolatedModules",
    ].flatMap(codesOf);
    for (const generic of ["TS2322", "TS2345", "TS2339", "TS2304", "TS2551"]) {
      expect(all).not.toContain(generic);
    }
  });

  it("counts the diagnostics of the artifact by code, and `[]` is a clean compile", () => {
    const text = JSON.stringify([
      { file: "a.ts", line: 1, column: 2, code: "TS7006", message: "m" },
      { file: "b.ts", line: 3, column: 4, code: "TS7006", message: "m" },
      { file: null, line: null, column: null, code: "TS5083", message: "m" },
    ]);
    expect(readDiagnostics(text)).toEqual(
      new Map([
        ["TS7006", 2],
        ["TS5083", 1],
      ]),
    );
    expect(readDiagnostics("[]")).toEqual(new Map());
  });

  it("is undefined for text that is not an array of diagnostics: missing, unparseable or a wrong shape", () => {
    expect(readDiagnostics(undefined)).toBeUndefined();
    expect(readDiagnostics("not json")).toBeUndefined();
    expect(readDiagnostics('{"code":"TS1"}')).toBeUndefined();
    expect(readDiagnostics("[1, 2]")).toBeUndefined();
  });

  it("an entry with no string code is not counted", () => {
    expect(readDiagnostics('[{"code": 7006}, {"message": "m"}]')).toEqual(new Map());
  });
});

describe("G4b the whole table of codes", () => {
  it("lists exactly the codes each flag raises", () => {
    const table: Record<string, string[]> = {
      noImplicitAny: [
        "TS7005",
        "TS7006",
        "TS7008",
        "TS7010",
        "TS7011",
        "TS7015",
        "TS7016",
        "TS7017",
        "TS7018",
        "TS7019",
        "TS7022",
        "TS7023",
        "TS7024",
        "TS7031",
        "TS7034",
        "TS7035",
        "TS7053",
      ],
      strictNullChecks: [
        "TS2531",
        "TS2532",
        "TS2533",
        "TS2721",
        "TS2722",
        "TS2723",
        "TS18047",
        "TS18048",
        "TS18049",
      ],
      strictPropertyInitialization: ["TS2564", "TS2565"],
      noImplicitThis: ["TS2683"],
      useUnknownInCatchVariables: ["TS18046"],
      noUncheckedIndexedAccess: ["TS18048"],
      exactOptionalPropertyTypes: ["TS2375", "TS2379", "TS2412"],
      noImplicitOverride: ["TS4114", "TS4115", "TS4116", "TS4119", "TS4120"],
      noFallthroughCasesInSwitch: ["TS7029"],
      verbatimModuleSyntax: ["TS1484", "TS1485"],
      isolatedModules: ["TS1205", "TS1208", "TS2748"],
      erasableSyntaxOnly: ["TS1294"],
    };
    for (const [flag, codes] of Object.entries(table)) {
      expect(codesOf(flag), flag).toEqual(codes);
    }
  });
});
