// Handler `sorteio`: do sorteio pedido pelo organizador aos pares gravados.
// A biblioteca só chama o handler com o pedido aberto e grava `running`/`failed`; os passos
// guardam no ow.db só ids e contagens. Os pares (quem tira quem) NÃO saem do passo `sortear`:
// `gravar-pares` os recalcula (o sorteio é determinístico pela seed = HMAC(SORTEIO_SEGREDO, id do
// command), ver nucleo/seed.ts), então nunca vão para o ow.db. A seed também não: é recalculada
// dentro de cada passo. `sorteios.error` é visível aos membros: só as mensagens fixas abaixo, as
// de `ErroSorteio` ou o `defaultErrorMessage`.
import { lookup, type TransactionChunk } from "@instantdb/admin";
import * as ic from "instant-commands/worker";
import { ErroSorteio, sortear, type Restricao } from "@amigo/dominio";
import type { AppSchema } from "@amigo/instant";
import { sorteio } from "@amigo/instant/commands";
import { defineHandler, type Ctx } from "../commands";
import { log } from "../nucleo/log";
import { escreverFase } from "../nucleo/progresso";
import { seedDoSorteio, validarSegredo } from "../nucleo/seed";
import { RETRY_PASSO_PADRAO, type AdminDb } from "./comum";

export const MSG_RODADA_INVALIDA = "Rodada inválida";
export const MSG_PARTICIPANTES_MUDARAM = "Os participantes mudaram durante o sorteio. Tente de novo.";
export const MSG_GRUPO_ENCERRADO = "O grupo foi encerrado.";
export const MSG_PADRAO_SORTEIO = "Não foi possível concluir o sorteio. Tente de novo.";

/** Sorteios por abertura do grupo (reabrir grava `rodadaBase = rodadaAtual`). */
export const LIMITE_RODADAS = 3;

/**
 * A rodada pedida é a seguinte à atual e cabe no limite da abertura.
 * `rodadaBase` ausente (grupo de antes de reabrir existir) vale 0.
 */
export function rodadaValida(rodada: number, rodadaAtual: number, rodadaBase: number | null | undefined): boolean {
  return rodada === rodadaAtual + 1 && rodada - (rodadaBase ?? 0) <= LIMITE_RODADAS;
}

type Comando = Ctx<typeof sorteio>["command"];

/** O que `carregar` devolve quando há trabalho a fazer (só ids). */
export type Carga = {
  grupoId: string;
  rodada: number;
  participantes: string[];
  restricoes: Restricao[];
  paresAntigos: string[];
};

/** Mínimo do admin SDK para o stream de progresso. */
type DbComStreams = Parameters<typeof escreverFase>[0];

/** Stream de progresso do sorteio (lido pelo PainelSorteio; regra em `$streams`). */
export const streamDoSorteio = (sorteioId: string) => `sorteio-${sorteioId}`;
const fase = (db: DbComStreams, sorteioId: string, f: "embaralhando" | "sorteando" | "pronto" | "erro") =>
  escreverFase(db, streamDoSorteio(sorteioId), f, f === "pronto" || f === "erro");

/**
 * Fase final `erro` no stream do sorteio. Chamada pelo `onEvent` do runner em `command.failed`
 * com `command === "sorteio"` (efeito colateral: não cabe no `onFailure`, que pode repetir).
 */
export function aoFalharSorteio(db: DbComStreams, commandId: string): void {
  fase(db, commandId, "erro");
}

/** Registra a falha de negócio no log e termina o pedido `failed` com a mensagem fixa. */
function falhar(sorteioId: string, mensagem: string, codigo: string): never {
  log("sorteio.erro", { sorteioId, codigo });
  ic.fail(mensagem);
}

/**
 * `onFailure` do handler: libera a chave `<grupoId>:<rodada>` renomeando-a para
 * `<chave>:erro:<id>`, na mesma transação que grava `failed`, para que a mesma rodada possa ser
 * pedida de novo. Sem `chave` string (entrada inválida), nada.
 */
export function liberarChave({ db, command }: ic.FailureContext<typeof sorteio, AppSchema>): TransactionChunk<any, any>[] {
  const { chave } = command;
  if (typeof chave !== "string") return [];
  const sufixo = `:erro:${command.id}`;
  if (chave.endsWith(sufixo)) return [];
  return [db.tx.sorteios[command.id]!.update({ chave: `${chave}${sufixo}` })];
}

/**
 * Estado atual do sorteio e do grupo, lido de novo dentro do passo que vai escrever.
 * Sem isto, um `update` num sorteio/grupo apagado (cascata ao apagar o grupo) recriaria
 * registros fantasmas: no Instant, `update` em id inexistente cria o registro.
 */
async function estadoAtual(db: AdminDb, sorteioId: string) {
  const { sorteios } = await db.query({
    sorteios: { $: { where: { id: sorteioId } }, pares: {}, grupo: { participantes: {} } },
  });
  const s = sorteios[0];
  return s?.grupo ? { s, g: s.grupo } : undefined;
}

/**
 * Passo `carregar`. Sorteio ou grupo inexistente (apagado em cascata) → `{ ignorado }`: a
 * biblioteca não escreve em pedido apagado. Rodada fora de sequência ou acima do limite da
 * abertura → `ic.fail(MSG_RODADA_INVALIDA)`. O status não é conferido: a biblioteca só chama o
 * handler com o pedido aberto. Só `rodada` e os links são lidos do sorteio.
 */
export async function carregar(db: AdminDb, sorteioId: string): Promise<{ ignorado: true } | Carga> {
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
  if (!s || !g) {
    log("sorteio.grupo_sumiu", { sorteioId });
    return { ignorado: true };
  }

  log("sorteio.iniciado", { sorteioId });
  if (!rodadaValida(s.rodada, g.rodadaAtual, g.rodadaBase)) falhar(sorteioId, MSG_RODADA_INVALIDA, "rodada-invalida");

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
 * Passo `sortear`: confere que o sorteio é possível e devolve só a contagem (os pares ficam aqui).
 * `ErroSorteio` (poucos participantes, restrições impossíveis) → `ic.fail` com a mensagem dele.
 */
export function contarPares(db: DbComStreams, segredo: string, sorteioId: string, carga: Carga): { pares: number } {
  fase(db, sorteioId, "embaralhando");
  fase(db, sorteioId, "sorteando");
  try {
    return { pares: sortear(carga.participantes, carga.restricoes, seedDoSorteio(segredo, sorteioId)).length };
  } catch (e) {
    if (e instanceof ErroSorteio) falhar(sorteioId, e.message, e.codigo);
    throw e;
  }
}

/**
 * Passo `gravar-pares`. Antes de escrever, relê o estado no mesmo passo:
 * - sorteio ou grupo sumiram (grupo apagado) → `{ ignorado }`, sem escrita nenhuma;
 * - sorteio já `done` (reexecução do passo) → devolve a contagem gravada;
 * - sorteio já terminado de outro jeito → `{ ignorado }`;
 * - grupo `encerrado` → `ic.fail(MSG_GRUPO_ENCERRADO)` (grupo e pares intocados);
 * - participantes ativos diferentes do `carregar` → `ic.fail(MSG_PARTICIPANTES_MUDARAM)`.
 * Senão, numa única transação: apaga os pares da rodada anterior (doador/receptor são
 * one-to-one), grava os novos por upsert na chave `<sorteioId>:<doador>`, marca o grupo
 * `sorteado` e o command `done` com `{ pares }`. Reexecutar é seguro: os mesmos pares (seed fixa)
 * caem nas mesmas chaves.
 */
export async function gravarPares(
  db: AdminDb,
  segredo: string,
  command: Pick<Comando, "id" | "complete">,
  carga: Carga,
): Promise<{ ignorado: true } | { pares: number }> {
  const sorteioId = command.id;
  const atual = await estadoAtual(db, sorteioId);
  if (!atual) {
    log("sorteio.grupo_sumiu", { sorteioId });
    return { ignorado: true };
  }
  const { s, g } = atual;
  if (s.status === "done") return { pares: s.pares.length };
  if (s.status !== "pending" && s.status !== "running") return { ignorado: true };
  if (g.status === "encerrado") falhar(sorteioId, MSG_GRUPO_ENCERRADO, "grupo-encerrado");
  const ativos = g.participantes.filter((p) => !p.removido).map((p) => p.id).sort();
  if (ativos.join(",") !== carga.participantes.join(",")) {
    falhar(sorteioId, MSG_PARTICIPANTES_MUDARAM, "participantes-mudaram");
  }

  const pares = sortear(carga.participantes, carga.restricoes, seedDoSorteio(segredo, sorteioId));
  await db.transact([
    ...carga.paresAntigos.map((p) => db.tx.pares[p]!.delete()),
    ...pares.map((p) =>
      // Upsert: o lookup cria o par com `chave` se ele não existe (update vazio).
      db.tx.pares[lookup("chave", `${sorteioId}:${p.doador}`)]!
        .update({})
        .link({ sorteio: sorteioId, doador: p.doador, receptor: p.receptor }),
    ),
    db.tx.grupos[carga.grupoId]!.update({ status: "sorteado", rodadaAtual: carga.rodada }),
    command.complete({ pares: pares.length }),
  ]);
  fase(db, sorteioId, "pronto");
  log("sorteio.concluido", { sorteioId, pares: pares.length });
  return { pares: pares.length };
}

/**
 * O handler do `sorteio` (versão "1"). `segredo` = SORTEIO_SEGREDO (seed; validado aqui).
 * `retryPolicy` só é sobrescrita pelos testes, para forçar uma falha rápida.
 */
export function criarSorteioHandler(opcoes: { segredo: string; retryPolicy?: ic.RetryPolicy }) {
  const segredo = validarSegredo(opcoes.segredo);
  return defineHandler(
    sorteio,
    async ({ db, command, step }) => {
      const carga = await step.run("carregar", carregar, db, command.id);
      if ("ignorado" in carga) return;
      await step.run("sortear", contarPares, db, segredo, command.id, carga);
      // `{ ignorado }` aqui: o pedido sumiu ou já terminou; a biblioteca não o sobrescreve.
      const r = await step.run("gravar-pares", gravarPares, db, segredo, command, carga);
      if ("pares" in r) return { pares: r.pares };
    },
    {
      version: "1",
      retryPolicy: opcoes.retryPolicy ?? RETRY_PASSO_PADRAO,
      defaultErrorMessage: MSG_PADRAO_SORTEIO,
      onFailure: liberarChave,
    },
  );
}
