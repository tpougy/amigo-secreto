import { expect, test } from "bun:test";
import { i } from "@instantdb/core";
import { sortear } from "../testes/sortear";
import { CommandDefinitionError, defineCommand } from "./index";
import { commandEntities, commandLinks } from "./schema";

test("generates standard attrs plus fields", () => {
  const e = commandEntities([sortear]).sorteios;
  expect(Object.keys(e.attrs).sort()).toEqual([
    "attempts", "chave", "createdAt", "error", "finishedAt", "result", "rodada", "status",
  ]);
  expect(e.attrs.status.config.indexed).toBe(true);
  expect(e.attrs.error.required).toBe(false);
  expect(e.attrs.result.required).toBe(false);
  expect(e.attrs.finishedAt.required).toBe(false);
  expect(e.attrs.attempts.required).toBe(true);
});

const other = (name: string, entity: string) =>
  defineCommand({ name, entity, fields: { x: i.string() }, allow: { create: "true", view: "true" } });

test("throws on repeated entity or name", () => {
  expect(() => commandEntities([other("a", "es"), other("b", "es")] as any)).toThrow(CommandDefinitionError);
  expect(() => commandEntities([other("a", "es"), other("a", "fs")] as any)).toThrow(CommandDefinitionError);
});

test("commandLinks returns the declared links", () => {
  expect(commandLinks([sortear])).toEqual(sortear.links!);
  expect(commandLinks([other("a", "es")])).toEqual({});
});
