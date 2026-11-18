import { describe, expect, it } from "vitest";
import config from "../../vitest.config.ts";

/** R74: the kit's own tests run real git, bun and ESLint processes, and the macOS runner is slower than Vitest's 5 s default. */

describe("R74: the kit's own Vitest config gives its real-tool tests room", () => {
  it("sets the test timeout to 30 s", () => {
    expect(config.test?.testTimeout).toBe(30_000);
  });
});
