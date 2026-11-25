import { expect, test } from "bun:test";
import { i } from "@instantdb/core";
import { defineCommand } from "./index";
import { validateInput } from "./fields";
import { sortear } from "../testes/sortear";

test("validateInput accepts a valid input", () => {
  expect(validateInput(sortear, { grupo: "g", rodada: 1, chave: "g:1" }, "client")).toEqual([]);
});

test("validateInput reports wrong type and missing required", () => {
  const p = validateInput(sortear, { grupo: "g", rodada: "2" }, "worker");
  expect(p).toHaveLength(2);
  expect(p.join(" ")).toContain("rodada");
  expect(p.join(" ")).toContain("chave");
});

test("validateInput client mode requires link ids", () => {
  const v = { grupo: "", rodada: 1, chave: "x" };
  expect(validateInput(sortear, v, "client")).toHaveLength(1);
  expect(validateInput(sortear, v, "worker")).toEqual([]);
});

test("validateInput accepts date as number, ISO string or Date", () => {
  const c = defineCommand({
    name: "d",
    entity: "ds",
    fields: { quando: i.date() },
    allow: { create: "true", view: "true" },
  });
  for (const v of [1, "2026-01-01T00:00:00Z", new Date()]) expect(validateInput(c, { quando: v }, "worker")).toEqual([]);
  expect(validateInput(c, { quando: "nope" }, "worker")).toHaveLength(1);
  expect(validateInput(c, { quando: NaN }, "worker")).toHaveLength(1);
});

test("validateInput optional may be absent; boolean and json checked", () => {
  const c = defineCommand({
    name: "o",
    entity: "os",
    fields: { a: i.boolean().optional(), b: i.json() },
    allow: { create: "true", view: "true" },
  });
  expect(validateInput(c, { b: { x: 1 } }, "worker")).toEqual([]);
  expect(validateInput(c, { a: "t", b: undefined }, "worker")).toHaveLength(2);
});
