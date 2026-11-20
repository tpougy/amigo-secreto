// Workflow `apagar-conta`: do pedido de exclusão (criado pela pessoa em /conta) à conta apagada.
// O cliente não pode apagar `$users` (o servidor só aceita a regra "false"), então o worker,
// como admin, executa o plano de `planoApagarConta` (@amigo/dominio).
// Inputs/outputs dos passos ficam no ow.db: só ids e contagens.
import { lookup, type TransactionChunk } from "@instantdb/admin";
import { defineWorkflowSpec, type OpenWorkflow, type RetryPolicy } from "openworkflow";
import { APELIDO_REMOVIDO, caminhoCapa, planoApagarConta, resumoPlano, type DadosConta } from "@amigo/dominio";
import { assinaturaInstant, iniciarCampainha } from "../nucleo/campainha";
import { dispararComRetomada } from "../nucleo/disparar";
import { log } from "../nucleo/log";
import { RETRY_PASSO_PADRAO, type AdminDb } from "./sortear";

export type EntradaConta = { pedidoId: string };
export type SaidaConta = { ignorado: true } | { anonimizadas: number; semRefazer: number; apagadas: number; grupos: number };

export const specApagarConta = defineWorkflowSpec<EntradaConta, SaidaConta>({
  name: "apagar-conta",
  version: "1",
  retryPolicy: { maximumAttempts: 1 },
});

/** Passo `carregar`: pedido pendente → id do usuário (ou `null` se o `$users` já não existe). */
export async function carregarPedido(
  db: AdminDb,
  pedidoId: string,
): Promise<{ ignorar: true } | { usuarioId: string | null }> {
  const { pedidosExclusao } = await db.query({
    pedidosExclusao: { $: { where: { id: pedidoId } }, usuario: {} },
  });
  const p = pedidosExclusao[0];
  if (!p || p.status !== "pendente") return { ignorar: true };
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
        ? [{ participanteId: p.id, grupoId: p.grupo.id, rodadaAtual: p.grupo.rodadaAtual, respostas: p.respostas.map((r) => r.id) }]
        : [],
    ),
    gruposOrganizados: (u?.gruposOrganizados ?? []).map((g) => g.id),
  };
}

/**
 * Passo `limpar-dados`: participações e grupos, numa transação só, a partir do estado ATUAL
 * (idempotente: depois de aplicado, o usuário não tem mais participações nem grupos, e o
 * plano fica vazio). Grupo já sorteado: a participação fica como "Participante removido",
 * `removidoNaRodada` = rodada atual (dispara o banner do organizador), sem usuário e sem
 * respostas. Grupo sem sorteio: a participação é apagada. Grupos organizados: apagados, com a capa.
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

export function definirApagarConta(ow: OpenWorkflow, db: AdminDb, opcoes: { retryPasso?: Partial<RetryPolicy> } = {}) {
  const RETRY_PASSO = opcoes.retryPasso ?? RETRY_PASSO_PADRAO;
  return ow.defineWorkflow(specApagarConta, async ({ input, step, run }): Promise<SaidaConta> => {
    const { pedidoId } = input;

    const carga = await step.run({ name: "carregar", retryPolicy: RETRY_PASSO }, async () => {
      const r = await carregarPedido(db, pedidoId);
      if (!("ignorar" in r)) log("conta.apagando", { pedidoId });
      return r;
    });
    if ("ignorar" in carga) return { ignorado: true };
    const { usuarioId } = carga;

    const resumo = await step.run({ name: "limpar-dados", retryPolicy: RETRY_PASSO }, async () =>
      usuarioId ? limparDados(db, usuarioId) : { anonimizadas: 0, semRefazer: 0, apagadas: 0, grupos: 0 },
    );

    // Apagar o usuário ANTES de concluir: se este passo esgotar as tentativas, o pedido continua
    // `pendente`, a campainha o entrega de novo e um run novo (com usuarioId já null, se o
    // usuário chegou a ser apagado) termina o trabalho.
    await step.run({ name: "apagar-usuario", retryPolicy: RETRY_PASSO }, async () => {
      // Devolve null se o usuário já não existe (reexecução): idempotente.
      if (usuarioId) await db.auth.deleteUser({ id: usuarioId });
      return null;
    });

    await step.run({ name: "concluir-pedido", retryPolicy: RETRY_PASSO }, async () => {
      await db.transact(db.tx.pedidosExclusao[pedidoId]!.update({ status: "concluido" }));
      return null;
    });

    const inicio = run.startedAt ? new Date(run.startedAt).getTime() : Date.now();
    log("conta.apagada", { pedidoId, ...resumo, duracaoMs: Date.now() - inicio });
    return resumo;
  });
}

export const CONSULTA_PEDIDOS = {
  pedidosExclusao: { $: { where: { status: "pendente" } } },
} as const;

/** Campainha sobre os pedidos pendentes: cada um vira um run com `idempotencyKey = pedidoId`. */
export function processarPedidosExclusao(ow: OpenWorkflow, db: AdminDb): { parar(): void } {
  return iniciarCampainha<{ id: string }>({
    nome: "pedidosExclusao",
    assinar: assinaturaInstant(db, CONSULTA_PEDIDOS),
    chave: (p) => p.id,
    disparar: (_p, pedidoId) => dispararComRetomada(ow, specApagarConta, { pedidoId }, pedidoId),
  });
}
