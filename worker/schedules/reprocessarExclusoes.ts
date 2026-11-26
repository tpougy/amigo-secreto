// Schedule `reprocessar-exclusoes`: todo dia às 04:00 de São Paulo, pedido de exclusão que ficou
// `failed` (retries esgotados, p. ex. Instant fora do ar) ganha um pedido novo, para a pessoa
// não ficar com a conta presa. O handler é idempotente (`limparDados` lê o estado atual).
import { sendCommand } from "instant-commands/client";
import { exclusaoConta } from "@amigo/instant/commands";
import { defineSchedule } from "../commands";
import type { AdminDb } from "../handlers/comum";
import { log } from "../nucleo/log";

/** Com tantos pedidos `failed` do mesmo usuário, o reprocessamento desiste. */
export const MAX_FALHAS = 3;

export type ResumoReprocesso = { criados: number; desistiu: number };

/**
 * Para cada usuário que ainda existe e tem pedido `failed`: sem pedido `pending`/`running`/`done`
 * e com menos de `MAX_FALHAS` falhas, cria um pedido novo (`sendCommand` com o admin: mesmos
 * campos padrão de um pedido criado pelo app); com `MAX_FALHAS` ou mais, desiste e registra
 * `exclusao.desistiu` (só o id do usuário).
 */
export async function reprocessar(db: AdminDb, _agora: number = Date.now()): Promise<ResumoReprocesso> {
  const { pedidosExclusao: falhos } = await db.query({
    pedidosExclusao: { $: { where: { status: "failed" } }, usuario: {} },
  });
  const usuarios = [...new Set(falhos.flatMap((p) => (p.usuario ? [p.usuario.id] : [])))];
  const resumo: ResumoReprocesso = { criados: 0, desistiu: 0 };
  if (usuarios.length === 0) return resumo;

  const { pedidosExclusao: todos } = await db.query({
    pedidosExclusao: { $: { where: { "usuario.id": { $in: usuarios } } }, usuario: {} },
  });
  for (const usuario of usuarios) {
    const dele = todos.filter((p) => p.usuario?.id === usuario);
    if (dele.some((p) => p.status === "pending" || p.status === "running" || p.status === "done")) continue;
    const falhas = dele.filter((p) => p.status === "failed").length;
    if (falhas >= MAX_FALHAS) {
      log("exclusao.desistiu", { usuarioId: usuario, falhas });
      resumo.desistiu++;
      continue;
    }
    await sendCommand(db, exclusaoConta, { usuario });
    resumo.criados++;
  }
  return resumo;
}

export const reprocessarExclusoes = defineSchedule({
  name: "reprocessar-exclusoes",
  cron: "0 4 * * *",
  timezone: "America/Sao_Paulo",
  run: async ({ db, step }) => {
    const r = await step.run("reprocessar", reprocessar, db);
    log("exclusao.reprocessadas", r);
    return r;
  },
});
