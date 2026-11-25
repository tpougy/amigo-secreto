import { i } from "@instantdb/core";
import { z } from "zod";
import { defineCommand } from "../src/index";

export const sortear = defineCommand({
  name: "sortear",
  entity: "sorteios",
  fields: {
    rodada: i.number(),
    chave: i.string().unique(),
  },
  links: {
    sorteioGrupo: {
      forward: { on: "sorteios", has: "one", label: "grupo", onDelete: "cascade" },
      reverse: { on: "grupos", has: "many", label: "sorteios" },
    },
  },
  bind: {
    ehOrganizador: "auth.id in data.ref('grupo.organizador.id')",
    ehMembro: "auth.id in data.ref('grupo.participantes.usuario.id')",
  },
  allow: {
    create: "ehOrganizador && data.rodada > 0",
    view: "ehOrganizador || ehMembro",
    delete: "ehOrganizador",
    link: { grupo: "auth.id in linkedData.ref('organizador.id')" },
  },
  rateLimit: { limits: [{ capacity: 5, refill: { amount: 5, period: "1 hour", type: "greedy" } }] },
  result: z.object({ pares: z.number().int() }),
});
