import { expect, test } from "bun:test";
import { adminICSemSchema } from "../helpers";

test("test app answers an admin query", async () => {
  const db = adminICSemSchema();
  const r = await db.query({ $users: { $: { limit: 1 } } });
  expect(Array.isArray(r.$users)).toBe(true);
});
