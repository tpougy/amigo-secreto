import { expect, test } from "bun:test";
import { i } from "@instantdb/core";
import { defineCommand, CommandDefinitionError, type CommandSpec } from "./index";
import { sortear } from "../testes/sortear";

const base = (): CommandSpec => ({
  name: "sortear",
  entity: "sorteios",
  fields: { rodada: i.number() },
  links: {
    sorteioGrupo: {
      forward: { on: "sorteios", has: "one", label: "grupo" },
      reverse: { on: "grupos", has: "many", label: "sorteios" },
    },
  },
  allow: { create: "true", view: "true" },
});

test("valid spec returns the same data", () => {
  expect(defineCommand(sortear).entity).toBe("sorteios");
});

test("rejects forward.on different from entity", () => {
  const s = base();
  s.links!.sorteioGrupo!.forward.on = "outros";
  expect(() => defineCommand(s)).toThrow(/forward\.on/);
});

test("rejects forward.has other than one", () => {
  const s = base();
  (s.links!.sorteioGrupo!.forward as any).has = "many";
  expect(() => defineCommand(s)).toThrow(/forward\.has/);
});

test("rejects reserved field names", () => {
  const s = base();
  s.fields = { status: i.string() };
  expect(() => defineCommand(s)).toThrow(/reserved/);
});

test("rejects allow.update and allow.unlink", () => {
  const s = base();
  (s.allow as any).update = "true";
  expect(() => defineCommand(s)).toThrow(/allow\.update/);
  const t = base();
  (t.allow as any).unlink = "true";
  expect(() => defineCommand(t)).toThrow(/allow\.unlink/);
});

test("rejects allow.link keys that are not forward labels", () => {
  const s = base();
  s.allow.link = { group: "true" };
  expect(() => defineCommand(s)).toThrow(/allow\.link\.group/);
});

test("requires allow.delete when a link cascades", () => {
  const s = base();
  s.links!.sorteioGrupo!.forward.onDelete = "cascade";
  expect(() => defineCommand(s)).toThrow(/allow\.delete/);
});

test("reports all problems at once", () => {
  const s = base();
  s.links!.sorteioGrupo!.forward.on = "outros";
  s.fields = { id: i.string() };
  try {
    defineCommand(s);
    throw new Error("should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(CommandDefinitionError);
    expect((e as CommandDefinitionError).problems).toHaveLength(2);
  }
});
