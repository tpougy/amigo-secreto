import { expect, test } from "bun:test";
import { i } from "@instantdb/core";
import { defineCommand, CommandDefinitionError } from "./index";
import { validateResult } from "./result";
import { sortear as cmdZod } from "../testes/sortear";

const cmdJson = defineCommand({
  name: "j",
  entity: "js",
  allow: { create: "true", view: "true" },
  result: i.json<{ n: number }>(),
});
const cmdSem = defineCommand({ name: "s", entity: "ss", allow: { create: "true", view: "true" } });

test("zod result: valid value passes and is the parsed output", () => {
  expect(validateResult(cmdZod, { pares: 3 })).toEqual({ ok: true, value: { pares: 3 } });
});

test("zod result: invalid value returns issues", () => {
  const r = validateResult(cmdZod, { pares: "x" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
});

test("async schema throws CommandDefinitionError", () => {
  const asyncSchema = {
    "~standard": { version: 1, vendor: "fake", validate: async (v: unknown) => ({ value: v }) },
  };
  const cmd = defineCommand({
    name: "a",
    entity: "as",
    allow: { create: "true", view: "true" },
    result: asyncSchema as any,
  });
  expect(() => validateResult(cmd, 1)).toThrow(CommandDefinitionError);
  expect(() => validateResult(cmd, 1)).toThrow("result schema must validate synchronously");
});

test("i.json result is not validated at runtime", () => {
  expect(validateResult(cmdJson, "anything")).toEqual({ ok: true, value: "anything" as any });
});

test("no result is not validated at runtime", () => {
  expect(validateResult(cmdSem, 1).ok).toBe(true);
});
