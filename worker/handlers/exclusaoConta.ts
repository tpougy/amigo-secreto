// Handler `exclusao-conta`: do pedido criado pela pessoa em /conta à conta apagada.
// O cliente não pode apagar `$users` (regra "false"), então o worker, como admin, executa o plano
// de `planoApagarConta` (@amigo/dominio). O handler devolve o resumo e a biblioteca grava `done`
// depois do último passo: o usuário é apagado antes de o pedido terminar. O pedido sobrevive ao
// usuário (sem cascata). Inputs/outputs dos passos ficam no ow.db: só ids e contagens.
import { lookup, type TransactionChunk } from "@instantdb/admin";
import * as ic from "instant-commands/worker";
import { exclusaoConta } from "@amigo/instant/commands";
import { APELIDO_REMOVIDO, caminhoCapa, planoApagarConta, resumoPlano, type DadosConta } from "@amigo/dominio";
import { defineHandler } from "../commands";
import { log } from "../nucleo/log";
import { RETRY_PASSO_PADRAO, type AdminDb } from "./comum";

export const MSG_PADRAO_EXCLUSAO = "Não foi possível apagar a conta.";

const SEM_RESUMO = { anonimizadas: 0, semRefazer: 0, apagadas: 0, grupos: 0 };

/**
 * Passo `carregar`: id do usuário (ou `null` se o `$users` já não existe). Pedido que sumiu →
 * `{ ignorado }` (a biblioteca não escreve em pedido apagado).
 */
export async function carregar(
  db: AdminDb,
  pedidoId: string,
): Promise<{ ignorado: true } | { usuarioId: string | null }> {
  const { pedidosExclusao } = await db.query({
    pedidosExclusao: { $: { where: { id: pedidoId } }, usuario: {} },
  });
  const p = pedidosExclusao[0];
  if (!p) return { ignorado: true };
  return { usuarioId: p.usuario?.id ?? null };
}

/** Estado atual da conta, só com ids (a entrada de `planoApagarConta`). */
export async function dadosDaConta(db: AdminDb, usuarioId: string): Promise<DadosConta> {
  const { $users } = await db.query({
    $users: {
      $: { where: { id: usuarioId } },
      participacoes: { grupo: {}, respostas: {} },
      gruposOrganizados: {},
    },
  });
  const u = $users[0];
  return {
    usuarioId,
    participacoes: (u?.participacoes ?? []).flatMap((p) =>
      p.grupo
        ? [{
            participanteId: p.id,
            grupoId: p.grupo.id,
            status: p.grupo.status,
            rodadaAtual: p.grupo.rodadaAtual,
            rodadaBase: p.grupo.rodadaBase ?? null,
            respostas: p.respostas.map((r) => r.id),
          }]
        : [],
    ),
    gruposOrganizados: (u?.gruposOrganizados ?? []).map((g) => g.id),
  };
}

/**
 * Passo `limpar-dados`: participações e grupos, numa transação só, a partir do estado ATUAL
 * (idempotente: depois de aplicado, o usuário não tem mais participações nem grupos, e o
 * plano fica vazio). Grupo já sorteado (não reaberto): a participação fica como "Participante
 * removido", `removidoNaRodada` = rodada atual (dispara o banner do organizador), sem usuário e
 * sem respostas. Grupo sem sorteio ou reaberto: a participação é apagada. Grupos organizados:
 * apagados, com a capa.
 */
export async function limparDados(db: AdminDb, usuarioId: string) {
  const ops = planoApagarConta(await dadosDaConta(db, usuarioId));
  const passos = ops.flatMap((o): TransactionChunk<any, any>[] => {
    switch (o.tipo) {
      case "anonimizar":
        return [
          db.tx.participantes[o.participanteId]!
            .update({ removido: true, removidoNaRodada: o.rodada, apelido: APELIDO_REMOVIDO })
            .unlink({ usuario: usuarioId }),
          ...o.respostas.map((r) => db.tx.respostas[r]!.delete()),
        ];
      case "apagar-participacao":
        return [db.tx.participantes[o.participanteId]!.delete()];
      case "apagar-grupo":
        // delete por lookup de path inexistente é no-op (grupo sem capa).
        return [db.tx.$files[lookup("path", caminhoCapa(o.grupoId))]!.delete(), db.tx.grupos[o.grupoId]!.delete()];
      default:
        return [];
    }
  });
  if (passos.length) await db.transact(passos);
  return resumoPlano(ops);
}

/** Passo `apagar-usuario`: idempotente (usuário que já não existe é ignorado pelo Instant). */
export async function apagarUsuario(db: AdminDb, usuarioId: string | null): Promise<null> {
  if (usuarioId) await db.auth.deleteUser({ id: usuarioId });
  return null;
}

/** O handler da `exclusaoConta` (versão "1"). `retryPolicy` só é sobrescrita pelos testes. */
export function criarExclusaoContaHandler(opcoes: { retryPolicy?: ic.RetryPolicy } = {}) {
  return defineHandler(
    exclusaoConta,
    async ({ db, command, step }) => {
      const carga = await step.run("carregar", carregar, db, command.id);
      if ("ignorado" in carga) return SEM_RESUMO;
      const { usuarioId } = carga;
      log("conta.apagando", { pedidoId: command.id });
      const resumo = usuarioId ? await step.run("limpar-dados", limparDados, db, usuarioId) : SEM_RESUMO;
      // Apagar o usuário ANTES de a biblioteca gravar `done`: se este passo esgotar as tentativas,
      // o pedido fica `failed` e o reprocessamento diário cria um novo.
      await step.run("apagar-usuario", apagarUsuario, db, usuarioId);
      log("conta.apagada", { pedidoId: command.id, ...resumo });
      return resumo;
    },
    {
      version: "1",
      retryPolicy: opcoes.retryPolicy ?? RETRY_PASSO_PADRAO,
      defaultErrorMessage: MSG_PADRAO_EXCLUSAO,
    },
  );
}
