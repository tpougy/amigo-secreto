// Workflow `sortear`: do sorteio pendente no Instant aos pares gravados.
// Inputs/outputs dos passos ficam no ow.db e aparecem no painel: só ids e contagens.
// Os pares (quem tira quem) NÃO saem do passo `sortear`; `gravar-pares` os recalcula
// (o sorteio é determinístico pela seed = HMAC(SORTEIO_SEGREDO, sorteioId), ver nucleo/seed.ts),
// então nunca vão para o ow.db. A seed também não: é recalculada dentro de cada passo.
import { lookup, type InstantAdminDatabase } from "@instantdb/admin";
import { defineWorkflowSpec, type OpenWorkflow, type RetryPolicy } from "openworkflow";
import { ErroSorteio, sortear, type Restricao } from "@amigo/dominio";
import type { AppSchema } from "../../instant.schema";
import { assinaturaInstant, iniciarCampainha } from "../nucleo/campainha";
import { dispararComRetomada } from "../nucleo/disparar";
import { log } from "../nucleo/log";
import { escreverFase } from "../nucleo/progresso";
import { seedDoSorteio } from "../nucleo/seed";

export type AdminDb = InstantAdminDatabase<AppSchema>;

export type Entrada = { sorteioId: string };
export type Saida = { pares: number } | { erro: string };

/** O que `carregar` devolve quando há trabalho a fazer (só ids). */
export type Carga = {
  grupoId: string;
  rodada: number;
  participantes: string[];
  restricoes: Restricao[];
  paresAntigos: string[];
};

/**
 * Passos que tocam o Instant: falha transitória (rede, Instant reiniciando, desligamento
 * das 04:30) é refeita com backoff. 300 tentativas, 1 s → 60 s: ~5 h no total. Os passos
 * são idempotentes, então insistir é seguro. Se mesmo assim o run falhar, `dispararSorteio`
 * abre um run novo na próxima entrega da campainha.
 */
export const RETRY_PASSO_PADRAO: Partial<RetryPolicy> = {
  maximumAttempts: 300,
  initialInterval: "1s",
  backoffCoefficient: 2,
  maximumInterval: "60s",
};

/**
 * Nível do workflow: erros fora de passos são bugs, não adianta refazer (1 tentativa).
 * Obs.: quando um PASSO esgota as tentativas, o OpenWorkflow 0.11 falha o run com a
 * política padrão (1), independentemente desta.
 */
export const specSortear = defineWorkflowSpec<Entrada, Saida>({
  name: "sortear",
  version: "1",
  retryPolicy: { maximumAttempts: 1 },
});

export const MSG_RODADA_INVALIDA = "Rodada inválida";

/** Stream de progresso do sorteio (lido pelo PainelSorteio; regra em `$streams`). */
export const streamDoSorteio = (sorteioId: string) => `sorteio-${sorteioId}`;
const fase = (db: AdminDb, sorteioId: string, f: "embaralhando" | "sorteando" | "pronto" | "erro") =>
  escreverFase(db, streamDoSorteio(sorteioId), f, f === "pronto" || f === "erro");

/** Marca o sorteio como `erro` e libera a chave `<grupoId>:<rodada>` (ruling do worker). */
async function marcarErro(
  db: AdminDb,
  sorteioId: string,
  grupoId: string,
  rodada: number,
  mensagem: string,
  codigo: string,
): Promise<void> {
  await db.transact(
    db.tx.sorteios[sorteioId]!.update({
      status: "erro",
      erro: mensagem,
      chave: `${grupoId}:${rodada}:erro:${sorteioId}`,
      concluidoEm: null,
    }),
  );
  fase(db, sorteioId, "erro");
  log("sorteio.erro", { sorteioId, codigo });
}

/**
 * Passo `carregar`. Sorteio inexistente ou já terminado → `{ ignorar }` (sem efeitos).
 * Rodada fora de sequência → marca erro e devolve `{ erro }`.
 * Só `status`, `rodada` e os links são lidos do sorteio: `erro`, `criadoEm` e
 * `concluidoEm` vêm do cliente e não são confiáveis.
 */
export async function carregar(
  db: AdminDb,
  sorteioId: string,
): Promise<{ ignorar: true } | { erro: string } | Carga> {
  const { sorteios } = await db.query({
    sorteios: {
      $: { where: { id: sorteioId } },
      grupo: {
        participantes: {},
        restricoes: { participanteA: {}, participanteB: {} },
      },
    },
  });
  const s = sorteios[0];
  const g = s?.grupo;
  if (!s || !g || (s.status !== "pendente" && s.status !== "processando")) return { ignorar: true };

  log("sorteio.iniciado", { sorteioId });
  if (s.rodada !== g.rodadaAtual + 1) {
    await marcarErro(db, sorteioId, g.id, s.rodada, MSG_RODADA_INVALIDA, "rodada-invalida");
    return { erro: MSG_RODADA_INVALIDA };
  }

  const participantes = g.participantes.filter((p) => !p.removido).map((p) => p.id).sort();
  const ativos = new Set(participantes);
  // Restrição que cita participante removido (ou sem um dos lados) é ignorada.
  const restricoes: Restricao[] = [];
  for (const r of g.restricoes) {
    const a = r.participanteA?.id;
    const b = r.participanteB?.id;
    if (a && b && ativos.has(a) && ativos.has(b)) restricoes.push({ a, b });
  }

  const { pares } = await db.query({
    pares: { $: { where: { "sorteio.grupo.id": g.id } } },
  });
  // Pares deste mesmo sorteio não são "antigos": o upsert por chave os reaproveita.
  const paresAntigos = pares.filter((p) => !p.chave.startsWith(`${sorteioId}:`)).map((p) => p.id);

  return { grupoId: g.id, rodada: s.rodada, participantes, restricoes, paresAntigos };
}

/**
 * Passo `gravar-pares`, numa única transação: apaga os pares da rodada anterior
 * (doador/receptor são one-to-one), grava os novos por upsert na chave
 * `<sorteioId>:<doador>`, marca o grupo `sorteado` e o sorteio `concluido`.
 * Reexecutar é seguro: os mesmos pares (seed fixa) caem nas mesmas chaves.
 */
export async function gravarPares(db: AdminDb, segredo: string, sorteioId: string, carga: Carga): Promise<number> {
  const pares = sortear(carga.participantes, carga.restricoes, seedDoSorteio(segredo, sorteioId));
  await db.transact([
    ...carga.paresAntigos.map((p) => db.tx.pares[p]!.delete()),
    ...pares.map((p) => {
      // Upsert: o lookup cria o par com `chave` se ele não existe (update vazio).
      return db.tx.pares[lookup("chave", `${sorteioId}:${p.doador}`)]!
        .update({})
        .link({ sorteio: sorteioId, doador: p.doador, receptor: p.receptor });
    }),
    db.tx.grupos[carga.grupoId]!.update({ status: "sorteado", rodadaAtual: carga.rodada }),
    db.tx.sorteios[sorteioId]!.update({ status: "concluido", concluidoEm: Date.now(), erro: null }),
  ]);
  return pares.length;
}

/**
 * Registra o workflow `sortear` (versão "1") no cliente do OpenWorkflow.
 * `segredo` = SORTEIO_SEGREDO (seed). `retryPasso` só existe para os testes forçarem uma falha rápida.
 */
export function definirSorteio(
  ow: OpenWorkflow,
  db: AdminDb,
  opcoes: { segredo: string; retryPasso?: Partial<RetryPolicy> },
) {
  const RETRY_PASSO = opcoes.retryPasso ?? RETRY_PASSO_PADRAO;
  const { segredo } = opcoes;
  return ow.defineWorkflow(specSortear, async ({ input, step, run }): Promise<Saida> => {
    const { sorteioId } = input;

    const carga = await step.run({ name: "carregar", retryPolicy: RETRY_PASSO }, () => carregar(db, sorteioId));
    if ("ignorar" in carga) return { pares: 0 };
    if ("erro" in carga) return { erro: carga.erro };

    await step.run({ name: "marcar-processando", retryPolicy: RETRY_PASSO }, async () => {
      await db.transact(db.tx.sorteios[sorteioId]!.update({ status: "processando" }));
      fase(db, sorteioId, "embaralhando");
      return null;
    });

    const resultado = await step.run({ name: "sortear", retryPolicy: RETRY_PASSO }, async () => {
      fase(db, sorteioId, "sorteando");
      try {
        return { pares: sortear(carga.participantes, carga.restricoes, seedDoSorteio(segredo, sorteioId)).length };
      } catch (e) {
        // Falha definitiva: marca erro e termina sem retry (não lança).
        if (!(e instanceof ErroSorteio)) throw e;
        await marcarErro(db, sorteioId, carga.grupoId, carga.rodada, e.message, e.codigo);
        return { erro: e.message };
      }
    });
    if ("erro" in resultado) return resultado;

    const pares = await step.run({ name: "gravar-pares", retryPolicy: RETRY_PASSO }, async () => {
      const n = await gravarPares(db, segredo, sorteioId, carga);
      fase(db, sorteioId, "pronto");
      const inicio = run.startedAt ? new Date(run.startedAt).getTime() : Date.now();
      log("sorteio.concluido", { sorteioId, pares: n, duracaoMs: Date.now() - inicio });
      return n;
    });
    return { pares };
  });
}

export const CONSULTA_PENDENTES = {
  sorteios: { $: { where: { status: { $in: ["pendente", "processando"] } } } },
} as const;

/**
 * Campainha sobre os sorteios pendentes/processando: cada um vira um run com
 * `idempotencyKey = sorteioId` (entregas repetidas não duplicam o run).
 */
export function processarPendentes(ow: OpenWorkflow, db: AdminDb): { parar(): void } {
  return iniciarCampainha<{ id: string }>({
    nome: "sorteios",
    assinar: assinaturaInstant(db, CONSULTA_PENDENTES),
    chave: (s) => s.id,
    disparar: (_s, sorteioId) => dispararSorteio(ow, sorteioId),
  });
}

/** Run do sorteio com retomada de run falho (ver `dispararComRetomada`). */
export function dispararSorteio(ow: OpenWorkflow, sorteioId: string): Promise<void> {
  return dispararComRetomada(ow, specSortear, { sorteioId }, sorteioId);
}
