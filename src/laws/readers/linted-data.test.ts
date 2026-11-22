import { describe, expect, it } from "vitest";
import { isData, trackedLinted } from "./files.ts";

describe("the data trees of section 17 in the lint laws' file set", () => {
  const tracked = [
    "src/a.ts",
    "fixtures/probe/rule-off-override/src/legacy/loose.ts",
    "fixtures/laws/W-01/bad/explicit-any.ts",
    "probes/w22/run.ts",
    "fixtures/page.astro",
    "probes/page.astro",
    "examples/node-service/src/server.ts",
    "src/fixtures/a.ts",
    "myfixtures/a.ts",
  ];

  it("are never asked of ESLint: they break rules on purpose and carry configs of their own", () => {
    expect(trackedLinted(tracked)).toEqual([
      "src/a.ts",
      "examples/node-service/src/server.ts",
      "src/fixtures/a.ts",
      "myfixtures/a.ts",
    ]);
  });

  it("are the two trees at the root, and no folder that only ends in one of their names", () => {
    expect(tracked.filter(isData)).toEqual([
      "fixtures/probe/rule-off-override/src/legacy/loose.ts",
      "fixtures/laws/W-01/bad/explicit-any.ts",
      "probes/w22/run.ts",
      "fixtures/page.astro",
      "probes/page.astro",
    ]);
  });
});
