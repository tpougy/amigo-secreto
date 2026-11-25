import { i } from "@instantdb/core";
import { defineCommand, type InputOf } from "../../src/index";
import { sortear } from "../sortear";

const c = defineCommand({ ...sortear });
type In = InputOf<typeof c>;
export const ok: In = { grupo: "g", rodada: 1, chave: "g:1" };
// @ts-expect-error missing chave
export const semChave: In = { grupo: "g", rodada: 1 };
// @ts-expect-error wrong label
export const labelErrado: In = { group: "g", rodada: 1, chave: "x" };
export const literal: "sorteios" = c.entity;

const opt = defineCommand({
  name: "nota",
  entity: "notas",
  fields: { titulo: i.string(), obs: i.string().optional() },
  allow: { create: "true", view: "true" },
});
type OptIn = InputOf<typeof opt>;
export const semObs: OptIn = { titulo: "t" };
export const comObs: OptIn = { titulo: "t", obs: "o" };
// @ts-expect-error titulo is required
export const semTitulo: OptIn = { obs: "o" };
