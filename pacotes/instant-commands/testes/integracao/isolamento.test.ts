import { join } from "node:path";
import { expect, test } from "bun:test";

test("browser entry points do not reach worker code", async () => {
  for (const entry of ["src/index.ts", "src/schema.ts", "src/perms.ts", "src/client.ts"]) {
    const out = await Bun.build({
      entrypoints: [join(import.meta.dir, "../..", entry)],
      target: "browser",
      external: ["@instantdb/core", "@standard-schema/spec"],
    });
    expect(out.success).toBe(true);
    const code = await out.outputs[0]!.text();
    expect(code).not.toMatch(/@instantdb\/admin|openworkflow|bun:sqlite|Bun\.serve/);
  }
});
