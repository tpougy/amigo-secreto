// Workflow `reabrir-grupo`: da reabertura pedida pelo organizador ao grupo aberto de novo.
// O organizador não enxerga os pares (regra), então não consegue apagá-los: ele cria uma
// `reaberturas` pendente e o worker, como admin, desfaz o sorteio.
// Inputs/outputs dos passos ficam no ow.db: só ids e contagens. `reaberturas.erro` é visível
// aos membros do grupo: só as mensagens fixas abaixo.
import { z } from "zod";
import { defineWorkflowSpec, type OpenWorkflow, type RetryPolicy } from "openworkflow";
import { assinaturaInstant, iniciarCampainha } from "../nucleo/campainha";
import { dispararComRetomada } from "../nucleo/disparar";
import { log } from "../nucleo/log";
import { RETRY_PASSO_PADRAO, type AdminDb } from "./sortear";

export const EntradaReaberturaSchema = z.object({ reaberturaId: z.uuid() });
export type EntradaReabertura = z.infer<typeof EntradaReaberturaSchema>;
export type SaidaReabertura = { ignorado: true } | { pares: number } | { erro: string };

export const specReabrirGrupo = defineWorkflowSpec<EntradaReabertura, SaidaReabertura>({
  name: "reabrir-grupo",
  schema: EntradaReaberturaSchema,
  version: "1",
  retryPolicy: { maximumAttempts: 1 },
});

export const MSG_GRUPO_NAO_EXISTE = "O grupo não existe mais";
export const MSG_GRUPO_NAO_SORTEADO = "O grupo não está sorteado";
export const MSG_SORTEIO_EM_ANDAMENTO = "Há um sorteio em andamento";

/** Passo `carregar`: reabertura inexistente ou já terminada → `{ ignorado }`. */
export async function carregarReabertura(db: AdminDb, reaberturaId: string): Promise<{ ignorado: true } | { pendente: true }> {
  const { reaberturas } = await db.query({ reaberturas: { $: { where: { id: reaberturaId } } } });
  const r = reaberturas[0];
  if (!r || r.status !== "pendente") return { ignorado: true };
  return { pendente: true };
}

const FALHAS = {
  inexistente: { erro: MSG_GRUPO_NAO_EXISTE, codigo: "grupo-inexistente" },
  naoSorteado: { erro: MSG_GRUPO_NAO_SORTEADO, codigo: "grupo-nao-sorteado" },
  emAndamento: { erro: MSG_SORTEIO_EM_ANDAMENTO, codigo: "sorteio-em-andamento" },
} as const;

function motivoErro(g: { status: string; sorteios: { status: string }[] } | undefined) {
  if (!g) return FALHAS.inexistente;
  if (g.status !== "sorteado") return FALHAS.naoSorteado;
  if (g.sorteios.some((s) => s.status === "pendente" || s.status === "processando")) return FALHAS.emAndamento;
  return null;
}

/**
 * Passo `reabrir`. Relê o estado no mesmo passo e escreve numa transação só:
 * - reabertura inexistente (apagada pelo organizador, ou em cascata com o grupo) ou já
 *   terminada → `{ ignorado }`, sem escrita nenhuma (um `update` em id apagado recriaria a
 *   reabertura como fantasma);
 * - grupo inexistente, não `sorteado` ou com sorteio `pendente`/`processando` → marca a
 *   reabertura `erro` (grupo e pares intocados);
 * - senão: apaga todos os pares do grupo, grava `aberto` e `rodadaBase = rodadaAtual`, marca
 *   a reabertura `concluido` e as outras `pendente` do grupo `erro` ("não está sorteado").
 * Reexecutar é seguro: depois de aplicado, a reabertura já não está `pendente`.
 */
export async function reabrir(db: AdminDb, reaberturaId: string): Promise<SaidaReabertura> {
  const { reaberturas } = await db.query({
    reaberturas: { $: { where: { id: reaberturaId } }, grupo: { sorteios: { pares: {} }, reaberturas: {} } },
  });
  const r = reaberturas[0];
  if (!r || r.status !== "pendente") return { ignorado: true };
  const g = r.grupo;

  const falha = motivoErro(g);
  if (falha || !g) {
    const f = falha ?? FALHAS.inexistente;
    await db.transact(db.tx.reaberturas[reaberturaId]!.update({ status: "erro", erro: f.erro }));
    log("reabertura.erro", { reaberturaId, grupoId: g?.id ?? "", codigo: f.codigo });
    return { erro: f.erro };
  }

  // Uma leitura só: os pares do grupo são os pares de todos os sorteios dele.
  const pares = g.sorteios.flatMap((s) => s.pares);
  // As outras reaberturas pendentes do grupo (duplo clique) terminam aqui, na mesma transação:
  // se uma delas ficasse pendente (retry longo) até depois de um sorteio novo, encontraria o
  // grupo `sorteado` e apagaria os pares novos. Assim, quando o run dela chega, é `ignorado`.
  const irmas = g.reaberturas.filter((x) => x.id !== reaberturaId && x.status === "pendente");
  await db.transact([
    ...pares.map((p) => db.tx.pares[p.id]!.delete()),
    db.tx.grupos[g.id]!.update({ status: "aberto", rodadaBase: g.rodadaAtual }),
    db.tx.reaberturas[reaberturaId]!.update({ status: "concluido", erro: null }),
    ...irmas.map((x) => db.tx.reaberturas[x.id]!.update({ status: "erro", erro: MSG_GRUPO_NAO_SORTEADO })),
  ]);
  for (const x of irmas) log("reabertura.erro", { reaberturaId: x.id, grupoId: g.id, codigo: "grupo-nao-sorteado" });
  log("reabertura.concluida", { reaberturaId, grupoId: g.id, pares: pares.length });
  return { pares: pares.length };
}

/**
 * Registra o workflow `reabrir-grupo` (versão "1"). `retryPasso` só existe para os testes
 * forçarem uma falha rápida.
 */
export function definirReabrirGrupo(ow: OpenWorkflow, db: AdminDb, opcoes: { retryPasso?: Partial<RetryPolicy> } = {}) {
  const RETRY_PASSO = opcoes.retryPasso ?? RETRY_PASSO_PADRAO;
  return ow.defineWorkflow(specReabrirGrupo, async ({ input, step }): Promise<SaidaReabertura> => {
    const { reaberturaId } = input;

    const carga = await step.run({ name: "carregar", retryPolicy: RETRY_PASSO }, () =>
      carregarReabertura(db, reaberturaId),
    );
    if ("ignorado" in carga) return carga;

    return step.run({ name: "reabrir", retryPolicy: RETRY_PASSO }, () => reabrir(db, reaberturaId));
  });
}

export const CONSULTA_REABERTURAS = {
  reaberturas: { $: { where: { status: "pendente" } } },
} as const;

/** Campainha sobre as reaberturas pendentes: cada uma vira um run com `idempotencyKey = reaberturaId`. */
export function processarReaberturas(ow: OpenWorkflow, db: AdminDb): { parar(): void } {
  return iniciarCampainha<{ id: string }>({
    nome: "reaberturas",
    assinar: assinaturaInstant(db, CONSULTA_REABERTURAS),
    chave: (r) => r.id,
    disparar: (_r, reaberturaId) => dispararComRetomada(ow, specReabrirGrupo, { reaberturaId }, reaberturaId),
  });
}
